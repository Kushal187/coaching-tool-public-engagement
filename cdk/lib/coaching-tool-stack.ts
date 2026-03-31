import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as stepfunctionsTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as path from 'path';

export class CoachingToolStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // =========================================================================
    // 1. S3 BUCKETS
    // =========================================================================

    // Frontend bucket — serves SPA via CloudFront with OAC
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `coaching-tool-frontend-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Documents bucket — stores ingested documents with lifecycle to Intelligent-Tiering
    const documentsBucket = new s3.Bucket(this, 'DocumentsBucket', {
      bucketName: `coaching-tool-documents-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'IntelligentTieringAfter30Days',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
        },
      ],
    });

    // Pipeline artifacts bucket — ephemeral, auto-delete after 7 days
    const pipelineArtifactsBucket = new s3.Bucket(this, 'PipelineArtifactsBucket', {
      bucketName: `coaching-tool-pipeline-artifacts-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          id: 'DeleteAfter7Days',
          enabled: true,
          expiration: cdk.Duration.days(7),
        },
      ],
    });

    // =========================================================================
    // 2. DYNAMODB TABLES
    // =========================================================================

    // Registry table — main data store for documents and content
    const registryTable = new dynamodb.Table(this, 'RegistryTable', {
      tableName: 'CoachingTool-Registry',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    registryTable.addGlobalSecondaryIndex({
      indexName: 'GSI-1',
      partitionKey: { name: 'document_id', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    registryTable.addGlobalSecondaryIndex({
      indexName: 'GSI-2',
      partitionKey: { name: 'content_type', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Cache table — for LLM response caching with TTL
    const cacheTable = new dynamodb.Table(this, 'CacheTable', {
      tableName: 'CoachingTool-Cache',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // Pipeline runs table — tracks pipeline execution state
    const pipelineRunsTable = new dynamodb.Table(this, 'PipelineRunsTable', {
      tableName: 'CoachingTool-PipelineRuns',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // =========================================================================
    // 3. SECRETS MANAGER
    // =========================================================================

    const openaiSecret = new secretsmanager.Secret(this, 'OpenAIApiKey', {
      secretName: 'coaching-tool/openai-api-key',
      description: 'OpenAI API key for coaching tool LLM operations',
      secretStringValue: cdk.SecretValue.unsafePlainText(
        JSON.stringify({ OPENAI_API_KEY: 'sk-REPLACE-ME' })
      ),
    });

    const weaviateSecret = new secretsmanager.Secret(this, 'WeaviateCredentials', {
      secretName: 'coaching-tool/weaviate-credentials',
      description: 'Weaviate vector database connection credentials',
      secretStringValue: cdk.SecretValue.unsafePlainText(
        JSON.stringify({
          WEAVIATE_HOST: 'REPLACE',
          WEAVIATE_API_KEY: 'REPLACE',
          WEAVIATE_SCHEME: 'https',
        })
      ),
    });

    const adminSecret = new secretsmanager.Secret(this, 'AdminCredentials', {
      secretName: 'coaching-tool/admin-credentials',
      description: 'Admin dashboard basic auth credentials',
      secretStringValue: cdk.SecretValue.unsafePlainText(
        JSON.stringify({
          username: 'admin',
          password: 'REPLACE-WITH-STRONG-PASSWORD',
        })
      ),
    });

    // =========================================================================
    // 4. LAMBDA LAYER
    // =========================================================================

    const sharedLayer = new lambda.LayerVersion(this, 'SharedLayer', {
      layerVersionName: 'coaching-tool-shared',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../layer/')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_22_X],
      compatibleArchitectures: [lambda.Architecture.ARM_64],
      description: 'Shared dependencies and utilities for coaching tool Lambda functions',
    });

    // =========================================================================
    // 5. IAM ROLES & POLICIES
    // =========================================================================

    // Base policy for all API Lambdas: Secrets Manager + X-Ray + Logs
    const apiLambdaBasePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'secretsmanager:GetSecretValue',
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        'xray:PutTraceSegments',
        'xray:PutTelemetryRecords',
      ],
      resources: ['*'],
    });

    // Admin Lambdas: base + DynamoDB + S3 (documents) + Step Functions
    const adminDynamoPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Query',
        'dynamodb:Scan',
        'dynamodb:BatchWriteItem',
        'dynamodb:BatchGetItem',
      ],
      resources: [
        registryTable.tableArn,
        `${registryTable.tableArn}/index/*`,
        cacheTable.tableArn,
        pipelineRunsTable.tableArn,
        `${pipelineRunsTable.tableArn}/index/*`,
      ],
    });

    const adminS3Policy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:PutObject',
        's3:DeleteObject',
        's3:ListBucket',
      ],
      resources: [
        documentsBucket.bucketArn,
        `${documentsBucket.bucketArn}/*`,
      ],
    });

    const adminStatesPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'states:StartExecution',
        'states:DescribeExecution',
        'states:ListExecutions',
      ],
      resources: ['*'],
    });

    // Pipeline Lambdas: base + S3 (pipeline artifacts) + DynamoDB BatchWriteItem
    const pipelineS3Policy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:PutObject',
        's3:DeleteObject',
        's3:ListBucket',
      ],
      resources: [
        pipelineArtifactsBucket.bucketArn,
        `${pipelineArtifactsBucket.bucketArn}/*`,
        documentsBucket.bucketArn,
        `${documentsBucket.bucketArn}/*`,
      ],
    });

    const pipelineDynamoPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:BatchWriteItem',
        'dynamodb:PutItem',
        'dynamodb:GetItem',
        'dynamodb:UpdateItem',
        'dynamodb:Query',
        'dynamodb:Scan',
      ],
      resources: [
        registryTable.tableArn,
        `${registryTable.tableArn}/index/*`,
        pipelineRunsTable.tableArn,
        `${pipelineRunsTable.tableArn}/index/*`,
      ],
    });

    // Basic Auth Lambda: only secretsmanager for admin-credentials
    const basicAuthPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['secretsmanager:GetSecretValue'],
      resources: [adminSecret.secretArn],
    });

    // =========================================================================
    // 6. LAMBDA FUNCTIONS — API
    // =========================================================================

    // Common environment variables for API Lambdas
    const commonEnv: Record<string, string> = {
      REGISTRY_TABLE: registryTable.tableName,
      CACHE_TABLE: cacheTable.tableName,
      PIPELINE_RUNS_TABLE: pipelineRunsTable.tableName,
      DOCUMENTS_BUCKET: documentsBucket.bucketName,
      PIPELINE_ARTIFACTS_BUCKET: pipelineArtifactsBucket.bucketName,
      OPENAI_SECRET_ARN: openaiSecret.secretArn,
      WEAVIATE_SECRET_ARN: weaviateSecret.secretArn,
      ADMIN_SECRET_ARN: adminSecret.secretArn,
      NODE_OPTIONS: '--enable-source-maps',
    };

    // --- LLM / Agent functions (900s timeout) ---

    const chatbotStreamFn = new lambda.Function(this, 'ChatbotStreamFn', {
      functionName: 'coaching-tool-chatbot-stream',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'chatbot-stream.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/')),
      memorySize: 512,
      timeout: cdk.Duration.seconds(900),
      layers: [sharedLayer],
      environment: commonEnv,
      tracing: lambda.Tracing.ACTIVE,
    });
    chatbotStreamFn.addToRolePolicy(apiLambdaBasePolicy);

    const agentJsonFn = new lambda.Function(this, 'AgentJsonFn', {
      functionName: 'coaching-tool-agent-json',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'agent-json.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/')),
      memorySize: 512,
      timeout: cdk.Duration.seconds(900),
      layers: [sharedLayer],
      environment: commonEnv,
      tracing: lambda.Tracing.ACTIVE,
    });
    agentJsonFn.addToRolePolicy(apiLambdaBasePolicy);

    const llmJsonFn = new lambda.Function(this, 'LlmJsonFn', {
      functionName: 'coaching-tool-llm-json',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'llm-json.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/')),
      memorySize: 256,
      timeout: cdk.Duration.seconds(900),
      layers: [sharedLayer],
      environment: commonEnv,
      tracing: lambda.Tracing.ACTIVE,
    });
    llmJsonFn.addToRolePolicy(apiLambdaBasePolicy);

    const scoreCaseStudiesFn = new lambda.Function(this, 'ScoreCaseStudiesFn', {
      functionName: 'coaching-tool-score-case-studies',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'score-case-studies.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/')),
      memorySize: 512,
      timeout: cdk.Duration.seconds(900),
      layers: [sharedLayer],
      environment: commonEnv,
      tracing: lambda.Tracing.ACTIVE,
    });
    scoreCaseStudiesFn.addToRolePolicy(apiLambdaBasePolicy);

    // --- Non-LLM functions (120s timeout) ---

    const caseStudiesReadFn = new lambda.Function(this, 'CaseStudiesReadFn', {
      functionName: 'coaching-tool-case-studies-read',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'case-studies-read.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/')),
      memorySize: 256,
      timeout: cdk.Duration.seconds(120),
      layers: [sharedLayer],
      environment: commonEnv,
      tracing: lambda.Tracing.ACTIVE,
    });
    caseStudiesReadFn.addToRolePolicy(apiLambdaBasePolicy);

    const adminReadFn = new lambda.Function(this, 'AdminReadFn', {
      functionName: 'coaching-tool-admin-read',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'admin-read.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/')),
      memorySize: 256,
      timeout: cdk.Duration.seconds(120),
      layers: [sharedLayer],
      environment: commonEnv,
      tracing: lambda.Tracing.ACTIVE,
    });
    adminReadFn.addToRolePolicy(apiLambdaBasePolicy);
    adminReadFn.addToRolePolicy(adminDynamoPolicy);
    adminReadFn.addToRolePolicy(adminS3Policy);
    adminReadFn.addToRolePolicy(adminStatesPolicy);

    const adminWriteFn = new lambda.Function(this, 'AdminWriteFn', {
      functionName: 'coaching-tool-admin-write',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'admin-write.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/')),
      memorySize: 256,
      timeout: cdk.Duration.seconds(120),
      layers: [sharedLayer],
      environment: commonEnv,
      tracing: lambda.Tracing.ACTIVE,
    });
    adminWriteFn.addToRolePolicy(apiLambdaBasePolicy);
    adminWriteFn.addToRolePolicy(adminDynamoPolicy);
    adminWriteFn.addToRolePolicy(adminS3Policy);
    adminWriteFn.addToRolePolicy(adminStatesPolicy);

    const adminIngestFn = new lambda.Function(this, 'AdminIngestFn', {
      functionName: 'coaching-tool-admin-ingest',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'admin-ingest.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/')),
      memorySize: 512,
      timeout: cdk.Duration.seconds(120),
      layers: [sharedLayer],
      environment: commonEnv,
      tracing: lambda.Tracing.ACTIVE,
    });
    adminIngestFn.addToRolePolicy(apiLambdaBasePolicy);
    adminIngestFn.addToRolePolicy(adminDynamoPolicy);
    adminIngestFn.addToRolePolicy(adminS3Policy);
    adminIngestFn.addToRolePolicy(adminStatesPolicy);

    const pipelineTriggerFn = new lambda.Function(this, 'PipelineTriggerFn', {
      functionName: 'coaching-tool-pipeline-trigger',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'pipeline-trigger.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/')),
      memorySize: 128,
      timeout: cdk.Duration.seconds(120),
      layers: [sharedLayer],
      environment: commonEnv,
      tracing: lambda.Tracing.ACTIVE,
    });
    pipelineTriggerFn.addToRolePolicy(apiLambdaBasePolicy);
    pipelineTriggerFn.addToRolePolicy(pipelineS3Policy);
    pipelineTriggerFn.addToRolePolicy(pipelineDynamoPolicy);
    pipelineTriggerFn.addToRolePolicy(adminStatesPolicy);

    const pipelineStatusFn = new lambda.Function(this, 'PipelineStatusFn', {
      functionName: 'coaching-tool-pipeline-status',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'pipeline-status.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/')),
      memorySize: 128,
      timeout: cdk.Duration.seconds(120),
      layers: [sharedLayer],
      environment: commonEnv,
      tracing: lambda.Tracing.ACTIVE,
    });
    pipelineStatusFn.addToRolePolicy(apiLambdaBasePolicy);
    pipelineStatusFn.addToRolePolicy(pipelineS3Policy);
    pipelineStatusFn.addToRolePolicy(pipelineDynamoPolicy);

    // --- Special: pdf-convert (Python 3.12, container image) ---

    const pdfConvertFn = new lambda.DockerImageFunction(this, 'PdfConvertFn', {
      functionName: 'coaching-tool-pdf-convert',
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '../../lambda/pdf-convert/')),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 2048,
      timeout: cdk.Duration.seconds(900),
      environment: commonEnv,
      tracing: lambda.Tracing.ACTIVE,
    });
    pdfConvertFn.addToRolePolicy(apiLambdaBasePolicy);
    pdfConvertFn.addToRolePolicy(adminS3Policy);

    // --- Special: admin-basic-auth (Lambda authorizer) ---

    const adminBasicAuthFn = new lambda.Function(this, 'AdminBasicAuthFn', {
      functionName: 'coaching-tool-admin-basic-auth',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'admin-basic-auth.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/')),
      memorySize: 128,
      timeout: cdk.Duration.seconds(120),
      layers: [sharedLayer],
      environment: {
        ADMIN_SECRET_ARN: adminSecret.secretArn,
      },
      tracing: lambda.Tracing.ACTIVE,
    });
    adminBasicAuthFn.addToRolePolicy(basicAuthPolicy);
    adminBasicAuthFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: ['*'],
    }));

    // =========================================================================
    // 7. PIPELINE LAMBDA FUNCTIONS (Step Functions)
    // =========================================================================

    const pipelineCommonEnv: Record<string, string> = {
      ...commonEnv,
    };

    const pipelineLoadRegistryFn = new lambda.Function(this, 'PipelineLoadRegistryFn', {
      functionName: 'coaching-tool-pipeline-load-registry',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'pipeline-load-registry.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/')),
      memorySize: 256,
      timeout: cdk.Duration.seconds(120),
      layers: [sharedLayer],
      environment: pipelineCommonEnv,
      tracing: lambda.Tracing.ACTIVE,
    });
    pipelineLoadRegistryFn.addToRolePolicy(apiLambdaBasePolicy);
    pipelineLoadRegistryFn.addToRolePolicy(pipelineS3Policy);
    pipelineLoadRegistryFn.addToRolePolicy(pipelineDynamoPolicy);

    const pipelineProcessExcelFn = new lambda.DockerImageFunction(this, 'PipelineProcessExcelFn', {
      functionName: 'coaching-tool-pipeline-process-excel',
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '../../lambda/pipeline-process-excel/')),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 2048,
      timeout: cdk.Duration.seconds(900),
      environment: pipelineCommonEnv,
      tracing: lambda.Tracing.ACTIVE,
    });
    pipelineProcessExcelFn.addToRolePolicy(apiLambdaBasePolicy);
    pipelineProcessExcelFn.addToRolePolicy(pipelineS3Policy);
    pipelineProcessExcelFn.addToRolePolicy(pipelineDynamoPolicy);

    const pipelineClassifyFn = new lambda.DockerImageFunction(this, 'PipelineClassifyFn', {
      functionName: 'coaching-tool-pipeline-classify',
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '../../lambda/pipeline-classify/')),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(900),
      environment: pipelineCommonEnv,
      tracing: lambda.Tracing.ACTIVE,
    });
    pipelineClassifyFn.addToRolePolicy(apiLambdaBasePolicy);
    pipelineClassifyFn.addToRolePolicy(pipelineS3Policy);
    pipelineClassifyFn.addToRolePolicy(pipelineDynamoPolicy);

    const pipelineChunkFn = new lambda.Function(this, 'PipelineChunkFn', {
      functionName: 'coaching-tool-pipeline-chunk',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'pipeline-chunk.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/')),
      memorySize: 512,
      timeout: cdk.Duration.seconds(120),
      layers: [sharedLayer],
      environment: pipelineCommonEnv,
      tracing: lambda.Tracing.ACTIVE,
    });
    pipelineChunkFn.addToRolePolicy(apiLambdaBasePolicy);
    pipelineChunkFn.addToRolePolicy(pipelineS3Policy);
    pipelineChunkFn.addToRolePolicy(pipelineDynamoPolicy);

    const pipelineIngestWeaviateFn = new lambda.Function(this, 'PipelineIngestWeaviateFn', {
      functionName: 'coaching-tool-pipeline-ingest-weaviate',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'pipeline-ingest-weaviate.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/')),
      memorySize: 256,
      timeout: cdk.Duration.seconds(120),
      layers: [sharedLayer],
      environment: pipelineCommonEnv,
      tracing: lambda.Tracing.ACTIVE,
    });
    pipelineIngestWeaviateFn.addToRolePolicy(apiLambdaBasePolicy);
    pipelineIngestWeaviateFn.addToRolePolicy(pipelineS3Policy);
    pipelineIngestWeaviateFn.addToRolePolicy(pipelineDynamoPolicy);

    const pipelineSummarizeCaseStudyFn = new lambda.DockerImageFunction(this, 'PipelineSummarizeCaseStudyFn', {
      functionName: 'coaching-tool-pipeline-summarize-case-study',
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '../../lambda/pipeline-summarize-case-study/')),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(900),
      environment: pipelineCommonEnv,
      tracing: lambda.Tracing.ACTIVE,
    });
    pipelineSummarizeCaseStudyFn.addToRolePolicy(apiLambdaBasePolicy);
    pipelineSummarizeCaseStudyFn.addToRolePolicy(pipelineS3Policy);
    pipelineSummarizeCaseStudyFn.addToRolePolicy(pipelineDynamoPolicy);

    const pipelineIngestCaseStudyFn = new lambda.Function(this, 'PipelineIngestCaseStudyFn', {
      functionName: 'coaching-tool-pipeline-ingest-case-study',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'pipeline-ingest-case-study.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/')),
      memorySize: 256,
      timeout: cdk.Duration.seconds(120),
      layers: [sharedLayer],
      environment: pipelineCommonEnv,
      tracing: lambda.Tracing.ACTIVE,
    });
    pipelineIngestCaseStudyFn.addToRolePolicy(apiLambdaBasePolicy);
    pipelineIngestCaseStudyFn.addToRolePolicy(pipelineS3Policy);
    pipelineIngestCaseStudyFn.addToRolePolicy(pipelineDynamoPolicy);

    const pipelineClearCollectionsFn = new lambda.Function(this, 'PipelineClearCollectionsFn', {
      functionName: 'coaching-tool-pipeline-clear-collections',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'pipeline-clear-collections.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/')),
      memorySize: 256,
      timeout: cdk.Duration.seconds(120),
      layers: [sharedLayer],
      environment: pipelineCommonEnv,
      tracing: lambda.Tracing.ACTIVE,
    });
    pipelineClearCollectionsFn.addToRolePolicy(apiLambdaBasePolicy);
    pipelineClearCollectionsFn.addToRolePolicy(pipelineS3Policy);
    pipelineClearCollectionsFn.addToRolePolicy(pipelineDynamoPolicy);

    const pipelineUpdateStatusFn = new lambda.Function(this, 'PipelineUpdateStatusFn', {
      functionName: 'coaching-tool-pipeline-update-status',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'pipeline-update-status.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/')),
      memorySize: 128,
      timeout: cdk.Duration.seconds(120),
      layers: [sharedLayer],
      environment: pipelineCommonEnv,
      tracing: lambda.Tracing.ACTIVE,
    });
    pipelineUpdateStatusFn.addToRolePolicy(apiLambdaBasePolicy);
    pipelineUpdateStatusFn.addToRolePolicy(pipelineDynamoPolicy);

    // =========================================================================
    // 8. STEP FUNCTIONS STATE MACHINE
    // =========================================================================

    // Helper: build a per-document processing chain for a Map state.
    // Each branch of the Choice needs its own construct IDs, so we use a suffix.
    const buildDocumentProcessorChain = (suffix: string) => {
      const classify = new stepfunctionsTasks.LambdaInvoke(this, `ClassifyDocument${suffix}`, {
        lambdaFunction: pipelineClassifyFn,
        outputPath: '$.Payload',
      });
      const chunk = new stepfunctionsTasks.LambdaInvoke(this, `ChunkDocument${suffix}`, {
        lambdaFunction: pipelineChunkFn,
        outputPath: '$.Payload',
      });
      const ingestWeaviate = new stepfunctionsTasks.LambdaInvoke(this, `IngestToWeaviate${suffix}`, {
        lambdaFunction: pipelineIngestWeaviateFn,
        outputPath: '$.Payload',
      });
      const generateMetadata = new stepfunctionsTasks.LambdaInvoke(this, `GenerateMetadata${suffix}`, {
        lambdaFunction: pipelineSummarizeCaseStudyFn,
        outputPath: '$.Payload',
      });
      const ingestCaseStudy = new stepfunctionsTasks.LambdaInvoke(this, `IngestCaseStudy${suffix}`, {
        lambdaFunction: pipelineIngestCaseStudyFn,
        outputPath: '$.Payload',
      });

      const isCaseStudy = new stepfunctions.Choice(this, `IsCaseStudy${suffix}`)
        .when(
          stepfunctions.Condition.stringEquals('$.content_type', 'case_study'),
          generateMetadata.next(ingestCaseStudy)
        )
        .otherwise(new stepfunctions.Pass(this, `NotCaseStudy${suffix}`));

      return classify.next(chunk).next(ingestWeaviate).next(isCaseStudy);
    };

    // Helper: build a Map state with the document processor chain
    const buildMapState = (suffix: string) => {
      const map = new stepfunctions.Map(this, `ProcessDocuments${suffix}`, {
        maxConcurrency: 10,
        itemsPath: '$.documents',
        resultPath: '$.mapResults',
      });
      map.itemProcessor(buildDocumentProcessorChain(suffix));
      return map;
    };

    // Pipeline failed state — used for unknown modes and error catches
    const pipelineFailedTask = new stepfunctionsTasks.LambdaInvoke(this, 'PipelineFailed', {
      lambdaFunction: pipelineUpdateStatusFn,
      outputPath: '$.Payload',
    });

    // --- Clear branch ---
    const clearBranch = new stepfunctionsTasks.LambdaInvoke(this, 'ClearCollections', {
      lambdaFunction: pipelineClearCollectionsFn,
      outputPath: '$.Payload',
    }).next(
      new stepfunctionsTasks.LambdaInvoke(this, 'UpdateStatusClear', {
        lambdaFunction: pipelineUpdateStatusFn,
        outputPath: '$.Payload',
      })
    );

    // --- Single-registry branch ---
    const singleMap = buildMapState('Single');
    singleMap.addCatch(pipelineFailedTask, { resultPath: '$.error' });
    const singleBranch = new stepfunctionsTasks.LambdaInvoke(this, 'LoadRegistrySingle', {
      lambdaFunction: pipelineLoadRegistryFn,
      outputPath: '$.Payload',
    }).next(singleMap).next(
      new stepfunctionsTasks.LambdaInvoke(this, 'UpdateStatusSingle', {
        lambdaFunction: pipelineUpdateStatusFn,
        outputPath: '$.Payload',
      })
    );

    // --- Registry branch ---
    const registryMap = buildMapState('Registry');
    registryMap.addCatch(pipelineFailedTask, { resultPath: '$.error' });
    const registryBranch = new stepfunctionsTasks.LambdaInvoke(this, 'LoadRegistryEntries', {
      lambdaFunction: pipelineLoadRegistryFn,
      outputPath: '$.Payload',
    }).next(registryMap).next(
      new stepfunctionsTasks.LambdaInvoke(this, 'UpdateStatusRegistry', {
        lambdaFunction: pipelineUpdateStatusFn,
        outputPath: '$.Payload',
      })
    );

    // --- Excel branch ---
    const excelMap = buildMapState('Excel');
    excelMap.addCatch(pipelineFailedTask, { resultPath: '$.error' });
    const excelBranch = new stepfunctionsTasks.LambdaInvoke(this, 'ProcessExcel', {
      lambdaFunction: pipelineProcessExcelFn,
      outputPath: '$.Payload',
    }).next(excelMap).next(
      new stepfunctionsTasks.LambdaInvoke(this, 'UpdateStatusExcel', {
        lambdaFunction: pipelineUpdateStatusFn,
        outputPath: '$.Payload',
      })
    );

    // DetermineMode choice state
    const determineMode = new stepfunctions.Choice(this, 'DetermineMode')
      .when(
        stepfunctions.Condition.stringEquals('$.mode', 'clear'),
        clearBranch
      )
      .when(
        stepfunctions.Condition.stringEquals('$.mode', 'single-registry'),
        singleBranch
      )
      .when(
        stepfunctions.Condition.stringEquals('$.mode', 'registry'),
        registryBranch
      )
      .when(
        stepfunctions.Condition.stringEquals('$.mode', 'excel'),
        excelBranch
      )
      .otherwise(pipelineFailedTask);

    // State machine
    const stateMachine = new stepfunctions.StateMachine(this, 'IngestionPipelineStateMachine', {
      stateMachineName: 'coaching-tool-ingestion-pipeline',
      definitionBody: stepfunctions.DefinitionBody.fromChainable(determineMode),
      stateMachineType: stepfunctions.StateMachineType.STANDARD,
      timeout: cdk.Duration.hours(2),
      tracingEnabled: true,
    });

    // Grant Step Functions invoke permissions on all pipeline Lambdas
    pipelineClearCollectionsFn.grantInvoke(stateMachine);
    pipelineLoadRegistryFn.grantInvoke(stateMachine);
    pipelineProcessExcelFn.grantInvoke(stateMachine);
    pipelineClassifyFn.grantInvoke(stateMachine);
    pipelineChunkFn.grantInvoke(stateMachine);
    pipelineIngestWeaviateFn.grantInvoke(stateMachine);
    pipelineSummarizeCaseStudyFn.grantInvoke(stateMachine);
    pipelineIngestCaseStudyFn.grantInvoke(stateMachine);
    pipelineUpdateStatusFn.grantInvoke(stateMachine);

    // Add state machine ARN to environment for trigger/status functions
    pipelineTriggerFn.addEnvironment('STATE_MACHINE_ARN', stateMachine.stateMachineArn);
    pipelineStatusFn.addEnvironment('STATE_MACHINE_ARN', stateMachine.stateMachineArn);
    adminIngestFn.addEnvironment('STATE_MACHINE_ARN', stateMachine.stateMachineArn);

    // =========================================================================
    // 9. API GATEWAY REST API
    // =========================================================================

    const api = new apigateway.RestApi(this, 'CoachingToolApi', {
      restApiName: 'coaching-tool-api',
      description: 'Coaching Tool REST API',
      deployOptions: {
        stageName: 'prod',
        tracingEnabled: true,
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Lambda Authorizer for admin routes
    const lambdaAuthorizer = new apigateway.RequestAuthorizer(this, 'AdminBasicAuthAuthorizer', {
      handler: adminBasicAuthFn,
      identitySources: [apigateway.IdentitySource.header('Authorization')],
      authorizerName: 'admin-basic-auth',
      resultsCacheTtl: cdk.Duration.seconds(0),
    });

    // Common integration options (no caching)
    const lambdaIntegrationOptions: apigateway.LambdaIntegrationOptions = {
      proxy: true,
    };

    // --- Public API routes ---
    const apiResource = api.root.addResource('api');

    // POST /api/chatbot (streaming enabled)
    const chatbotResource = apiResource.addResource('chatbot');
    chatbotResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(chatbotStreamFn, lambdaIntegrationOptions)
    );

    // POST /api/agent
    const agentResource = apiResource.addResource('agent');
    agentResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(agentJsonFn, lambdaIntegrationOptions)
    );

    // POST /api/llm
    const llmResource = apiResource.addResource('llm');
    llmResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(llmJsonFn, lambdaIntegrationOptions)
    );

    // POST /api/score-case-studies
    const scoreCaseStudiesResource = apiResource.addResource('score-case-studies');
    scoreCaseStudiesResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(scoreCaseStudiesFn, lambdaIntegrationOptions)
    );

    // GET /api/case-studies
    const caseStudiesResource = apiResource.addResource('case-studies');
    caseStudiesResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(caseStudiesReadFn, lambdaIntegrationOptions)
    );

    // --- Admin routes (protected by Lambda authorizer) ---
    const adminResource = apiResource.addResource('admin');
    const adminAuthOptions: apigateway.MethodOptions = {
      authorizer: lambdaAuthorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    };

    // GET /api/admin/registry
    const adminRegistryResource = adminResource.addResource('registry');
    adminRegistryResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(adminReadFn, lambdaIntegrationOptions),
      adminAuthOptions
    );

    // GET /api/admin/registry/{id}
    const adminRegistryIdResource = adminRegistryResource.addResource('{id}');
    adminRegistryIdResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(adminReadFn, lambdaIntegrationOptions),
      adminAuthOptions
    );

    // POST /api/admin/registry
    adminRegistryResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(adminWriteFn, lambdaIntegrationOptions),
      adminAuthOptions
    );

    // PUT /api/admin/registry/{id}
    adminRegistryIdResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(adminWriteFn, lambdaIntegrationOptions),
      adminAuthOptions
    );

    // DELETE /api/admin/registry/{id}
    adminRegistryIdResource.addMethod(
      'DELETE',
      new apigateway.LambdaIntegration(adminWriteFn, lambdaIntegrationOptions),
      adminAuthOptions
    );

    // POST /api/admin/ingest
    const adminIngestResource = adminResource.addResource('ingest');
    adminIngestResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(adminIngestFn, lambdaIntegrationOptions),
      adminAuthOptions
    );

    // POST /api/admin/pipeline/trigger
    const adminPipelineResource = adminResource.addResource('pipeline');
    const adminPipelineTriggerResource = adminPipelineResource.addResource('trigger');
    adminPipelineTriggerResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(pipelineTriggerFn, lambdaIntegrationOptions),
      adminAuthOptions
    );

    // GET /api/admin/pipeline/status
    const adminPipelineStatusResource = adminPipelineResource.addResource('status');
    adminPipelineStatusResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(pipelineStatusFn, lambdaIntegrationOptions),
      adminAuthOptions
    );

    // GET /api/admin/pipeline/status/{runId}
    const adminPipelineStatusIdResource = adminPipelineStatusResource.addResource('{runId}');
    adminPipelineStatusIdResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(pipelineStatusFn, lambdaIntegrationOptions),
      adminAuthOptions
    );

    // POST /api/admin/pdf-convert
    const adminPdfConvertResource = adminResource.addResource('pdf-convert');
    adminPdfConvertResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(pdfConvertFn, lambdaIntegrationOptions),
      adminAuthOptions
    );

    // =========================================================================
    // 10. CLOUDFRONT DISTRIBUTION
    // =========================================================================

    // OAC for S3 frontend bucket
    const oac = new cloudfront.S3OriginAccessControl(this, 'FrontendOAC', {
      originAccessControlName: 'coaching-tool-frontend-oac',
      signing: cloudfront.Signing.SIGV4_ALWAYS,
    });

    // S3 origin with OAC
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(frontendBucket, {
      originAccessControl: oac,
    });

    // API Gateway origin
    const apiOrigin = new origins.HttpOrigin(
      `${api.restApiId}.execute-api.${this.region}.amazonaws.com`,
      {
        originPath: '/prod',
      }
    );

    const distribution = new cloudfront.Distribution(this, 'CoachingToolDistribution', {
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
    });

    // =========================================================================
    // 11. CLOUDWATCH ALARMS + SNS
    // =========================================================================

    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: 'coaching-tool-alarms',
      displayName: 'Coaching Tool Alarm Notifications',
    });

    // Chatbot Error Rate alarm (>5% in 5 min)
    const chatbotErrorsMetric = chatbotStreamFn.metricErrors({
      period: cdk.Duration.minutes(5),
      statistic: 'Sum',
    });
    const chatbotInvocationsMetric = chatbotStreamFn.metricInvocations({
      period: cdk.Duration.minutes(5),
      statistic: 'Sum',
    });

    const chatbotErrorRateAlarm = new cloudwatch.Alarm(this, 'ChatbotErrorRateAlarm', {
      alarmName: 'coaching-tool-chatbot-error-rate',
      alarmDescription: 'Chatbot Lambda error rate exceeds 5% over 5 minutes',
      metric: new cloudwatch.MathExpression({
        expression: '(errors / invocations) * 100',
        usingMetrics: {
          errors: chatbotErrorsMetric,
          invocations: chatbotInvocationsMetric,
        },
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    chatbotErrorRateAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // Chatbot Latency alarm (p99 > 100s)
    const chatbotLatencyAlarm = new cloudwatch.Alarm(this, 'ChatbotLatencyAlarm', {
      alarmName: 'coaching-tool-chatbot-latency',
      alarmDescription: 'Chatbot Lambda p99 latency exceeds 100 seconds',
      metric: chatbotStreamFn.metricDuration({
        period: cdk.Duration.minutes(5),
        statistic: 'p99',
      }),
      threshold: 100000, // 100 seconds in milliseconds
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    chatbotLatencyAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // API Gateway 5xx alarm (>10 in 5 min)
    const apiGateway5xxAlarm = new cloudwatch.Alarm(this, 'ApiGateway5xxAlarm', {
      alarmName: 'coaching-tool-api-5xx',
      alarmDescription: 'API Gateway 5xx errors exceed 10 in 5 minutes',
      metric: api.metricServerError({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    apiGateway5xxAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // Pipeline Failure alarm (>0 in 1 hour)
    const pipelineFailureAlarm = new cloudwatch.Alarm(this, 'PipelineFailureAlarm', {
      alarmName: 'coaching-tool-pipeline-failure',
      alarmDescription: 'Step Functions pipeline execution failures detected',
      metric: stateMachine.metricFailed({
        period: cdk.Duration.hours(1),
        statistic: 'Sum',
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    pipelineFailureAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // DynamoDB Throttling alarm (>0)
    const registryThrottleAlarm = new cloudwatch.Alarm(this, 'DynamoDBThrottlingAlarm', {
      alarmName: 'coaching-tool-dynamodb-throttling',
      alarmDescription: 'DynamoDB read/write throttle events detected',
      metric: registryTable.metricThrottledRequestsForOperations({
        operations: [
          dynamodb.Operation.GET_ITEM,
          dynamodb.Operation.PUT_ITEM,
          dynamodb.Operation.QUERY,
          dynamodb.Operation.SCAN,
        ],
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    registryThrottleAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // =========================================================================
    // OUTPUTS
    // =========================================================================

    new cdk.CfnOutput(this, 'CloudFrontDistributionUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'CloudFront distribution URL',
    });

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: api.url,
      description: 'API Gateway base URL',
    });

    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: frontendBucket.bucketName,
      description: 'S3 bucket for frontend assets',
    });

    new cdk.CfnOutput(this, 'DocumentsBucketName', {
      value: documentsBucket.bucketName,
      description: 'S3 bucket for ingested documents',
    });

    new cdk.CfnOutput(this, 'PipelineArtifactsBucketName', {
      value: pipelineArtifactsBucket.bucketName,
      description: 'S3 bucket for pipeline artifacts',
    });

    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: stateMachine.stateMachineArn,
      description: 'Ingestion pipeline state machine ARN',
    });

    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: alarmTopic.topicArn,
      description: 'SNS topic for CloudWatch alarm notifications',
    });
  }
}
