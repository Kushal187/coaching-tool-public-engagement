# AWS Permissions Request — Coaching Tool Serverless Deployment

**Requested by:** Kushal Pendekanti (coaching-cohort-5)
**Account:** 530075910224
**Region:** us-east-1
**Date:** 2026-03-30

---

## Summary

We are migrating the Coaching Tool application from Render to a fully serverless AWS architecture using AWS CDK (Infrastructure as Code). The deployment requires a one-time CDK bootstrap and ongoing `cdk deploy` permissions.

---

## 1. CDK Bootstrap (One-Time Setup)

CDK bootstrap creates a `CDKToolkit` CloudFormation stack with staging resources. This only needs to run **once per account/region**.

**Option A:** An admin runs this command once:
```bash
npx cdk bootstrap aws://530075910224/us-east-1
```

**Option B:** Grant the developer temporary admin-level permissions to run bootstrap, then revoke.

### Bootstrap Creates These Resources:
| Resource | Purpose |
|----------|---------|
| S3 Bucket (`cdk-hnb659fds-assets-*`) | Stores Lambda code zips and CloudFormation templates before deployment |
| ECR Repository (`cdk-hnb659fds-container-assets-*`) | Stores Docker images for 4 Python-based Lambda functions |
| IAM Roles (4 roles: `cdk-hnb659fds-*`) | CloudFormation execution roles, deploy role, file-publishing role, image-publishing role |
| SSM Parameter (`/cdk-bootstrap/hnb659fds/version`) | Tracks bootstrap version |

### Permissions Required for Bootstrap:
| Service | Actions | Scope |
|---------|---------|-------|
| CloudFormation | `cloudformation:*` | Stack: `CDKToolkit` |
| S3 | `s3:CreateBucket`, `s3:PutBucketPolicy`, `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:PutBucketVersioning`, `s3:PutEncryptionConfiguration`, `s3:PutLifecycleConfiguration`, `s3:PutBucketPublicAccessBlock` | Bucket: `cdk-hnb659fds-assets-530075910224-us-east-1` |
| ECR | `ecr:CreateRepository`, `ecr:SetRepositoryPolicy`, `ecr:PutLifecyclePolicy`, `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, `ecr:PutImage`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload` | Repository: `cdk-hnb659fds-container-assets-530075910224-us-east-1` |
| IAM | `iam:CreateRole`, `iam:PutRolePolicy`, `iam:AttachRolePolicy`, `iam:GetRole`, `iam:PassRole`, `iam:TagRole` | Roles: `cdk-hnb659fds-*` |
| SSM | `ssm:PutParameter`, `ssm:GetParameter` | Parameter: `/cdk-bootstrap/hnb659fds/version` |
| STS | `sts:GetCallerIdentity` | `*` |

---

## 2. CDK Deploy (Ongoing)

After bootstrap, each `cdk deploy` creates/updates the application stack. The developer needs these permissions:

### 2a. CloudFormation
| Action | Scope | Why |
|--------|-------|-----|
| `cloudformation:CreateStack` | `CoachingToolStack` | Create the application stack |
| `cloudformation:UpdateStack` | `CoachingToolStack` | Update on subsequent deploys |
| `cloudformation:DescribeStacks` | `CoachingToolStack` | Check deployment status |
| `cloudformation:DescribeStackEvents` | `CoachingToolStack` | Monitor deployment progress |
| `cloudformation:GetTemplate` | `CoachingToolStack` | Diff changes before deploy |
| `cloudformation:DeleteStack` | `CoachingToolStack` | Tear down if needed |
| `cloudformation:CreateChangeSet` | `CoachingToolStack` | Preview changes |
| `cloudformation:ExecuteChangeSet` | `CoachingToolStack` | Apply changes |

### 2b. S3 (3 Buckets + CDK Staging Bucket)
| Action | Scope | Why |
|--------|-------|-----|
| `s3:CreateBucket` | `coaching-tool-frontend-*`, `coaching-tool-documents-*`, `coaching-tool-pipeline-artifacts-*` | Create application buckets |
| `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` | Same + CDK staging bucket | Upload assets, deploy frontend |
| `s3:PutBucketPolicy`, `s3:PutBucketVersioning`, `s3:PutEncryptionConfiguration`, `s3:PutLifecycleConfiguration`, `s3:PutBucketPublicAccessBlock` | Application buckets | Configure bucket settings |

### 2c. Lambda (20 Functions + 1 Layer)
| Action | Scope | Why |
|--------|-------|-----|
| `lambda:CreateFunction`, `lambda:UpdateFunctionCode`, `lambda:UpdateFunctionConfiguration`, `lambda:DeleteFunction` | `coaching-tool-*` | Deploy 20 Lambda functions |
| `lambda:PublishLayerVersion`, `lambda:DeleteLayerVersion` | `coaching-tool-shared` | Deploy shared dependency layer |
| `lambda:GetFunction`, `lambda:ListVersionsByFunction` | `coaching-tool-*` | Check deployment state |
| `lambda:AddPermission`, `lambda:RemovePermission` | `coaching-tool-*` | Allow API Gateway to invoke Lambdas |
| `lambda:TagResource` | `coaching-tool-*` | Apply Environment/Project tags |

### 2d. API Gateway
| Action | Scope | Why |
|--------|-------|-----|
| `apigateway:POST`, `apigateway:GET`, `apigateway:PUT`, `apigateway:DELETE`, `apigateway:PATCH` | `*` (API Gateway requires `*` scope) | Create REST API with 20 routes, Lambda integrations, authorizer |

### 2e. DynamoDB (3 Tables)
| Action | Scope | Why |
|--------|-------|-----|
| `dynamodb:CreateTable`, `dynamodb:UpdateTable`, `dynamodb:DeleteTable`, `dynamodb:DescribeTable` | `CoachingTool-Registry`, `CoachingTool-Cache`, `CoachingTool-PipelineRuns` | Create 3 tables with GSIs |
| `dynamodb:UpdateTimeToLive`, `dynamodb:DescribeTimeToLive` | `CoachingTool-Cache` | Enable TTL for cache expiry |
| `dynamodb:TagResource` | All 3 tables | Apply tags |

### 2f. IAM (Execution Roles for Lambda + Step Functions)
| Action | Scope | Why |
|--------|-------|-----|
| `iam:CreateRole`, `iam:DeleteRole`, `iam:GetRole`, `iam:PassRole` | `CoachingToolStack-*` | Create execution roles for Lambdas, Step Functions, API Gateway |
| `iam:PutRolePolicy`, `iam:DeleteRolePolicy`, `iam:GetRolePolicy` | `CoachingToolStack-*` | Attach permissions to execution roles |
| `iam:AttachRolePolicy`, `iam:DetachRolePolicy` | `CoachingToolStack-*` | Attach AWS managed policies (X-Ray, etc.) |
| `iam:TagRole` | `CoachingToolStack-*` | Apply tags |

### 2g. CloudFront
| Action | Scope | Why |
|--------|-------|-----|
| `cloudfront:CreateDistribution`, `cloudfront:UpdateDistribution`, `cloudfront:DeleteDistribution`, `cloudfront:GetDistribution` | `*` | Create CDN distribution for frontend + API |
| `cloudfront:CreateOriginAccessControl`, `cloudfront:DeleteOriginAccessControl` | `*` | Secure S3 access |
| `cloudfront:CreateInvalidation` | `*` | Invalidate cache on frontend deploy |
| `cloudfront:TagResource` | `*` | Apply tags |

### 2h. Step Functions
| Action | Scope | Why |
|--------|-------|-----|
| `states:CreateStateMachine`, `states:UpdateStateMachine`, `states:DeleteStateMachine`, `states:DescribeStateMachine` | `CoachingTool-IngestionPipeline` | Create ingestion pipeline workflow |
| `states:TagResource` | `CoachingTool-IngestionPipeline` | Apply tags |

### 2i. Secrets Manager
| Action | Scope | Why |
|--------|-------|-----|
| `secretsmanager:CreateSecret`, `secretsmanager:UpdateSecret`, `secretsmanager:DeleteSecret`, `secretsmanager:GetSecretValue`, `secretsmanager:PutSecretValue`, `secretsmanager:DescribeSecret` | `coaching-tool/*` | Create 3 secrets (OpenAI key, Weaviate creds, admin creds) |
| `secretsmanager:TagResource` | `coaching-tool/*` | Apply tags |

### 2j. SNS
| Action | Scope | Why |
|--------|-------|-----|
| `sns:CreateTopic`, `sns:DeleteTopic`, `sns:Subscribe`, `sns:SetTopicAttributes` | `CoachingToolStack-AlarmTopic*` | CloudWatch alarm notifications |
| `sns:TagResource` | `CoachingToolStack-AlarmTopic*` | Apply tags |

### 2k. CloudWatch
| Action | Scope | Why |
|--------|-------|-----|
| `cloudwatch:PutMetricAlarm`, `cloudwatch:DeleteAlarms`, `cloudwatch:DescribeAlarms` | `*` | Create 5 monitoring alarms |
| `logs:CreateLogGroup`, `logs:DeleteLogGroup`, `logs:PutRetentionPolicy` | `/aws/lambda/coaching-tool-*`, `/aws/apigateway/*`, `/aws/states/*` | Set log retention policies |

### 2l. ECR (for Docker Lambda images)
| Action | Scope | Why |
|--------|-------|-----|
| `ecr:GetAuthorizationToken` | `*` | Authenticate Docker client |
| `ecr:BatchCheckLayerAvailability`, `ecr:PutImage`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer` | CDK staging ECR repo | Push 4 Python Docker images |

### 2m. SSM (CDK reads bootstrap version)
| Action | Scope | Why |
|--------|-------|-----|
| `ssm:GetParameter` | `/cdk-bootstrap/hnb659fds/version` | Verify bootstrap is current |

### 2n. STS
| Action | Scope | Why |
|--------|-------|-----|
| `sts:AssumeRole` | CDK bootstrap roles (`cdk-hnb659fds-*`) | CDK assumes bootstrap roles to deploy |
| `sts:GetCallerIdentity` | `*` | Identify caller |

---

## 3. Resources Created by the Stack

| Resource Type | Count | Names |
|---------------|-------|-------|
| S3 Bucket | 3 | `coaching-tool-frontend-*`, `coaching-tool-documents-*`, `coaching-tool-pipeline-artifacts-*` |
| CloudFront Distribution | 1 | Auto-generated |
| DynamoDB Table | 3 | `CoachingTool-Registry`, `CoachingTool-Cache`, `CoachingTool-PipelineRuns` |
| Secrets Manager Secret | 3 | `coaching-tool/openai-api-key`, `coaching-tool/weaviate-credentials`, `coaching-tool/admin-credentials` |
| Lambda Function | 20 | `coaching-tool-chatbot-stream`, `coaching-tool-agent-json`, `coaching-tool-llm-json`, `coaching-tool-score-case-studies`, `coaching-tool-case-studies-read`, `coaching-tool-admin-read`, `coaching-tool-admin-write`, `coaching-tool-admin-ingest`, `coaching-tool-pdf-convert`, `coaching-tool-pipeline-trigger`, `coaching-tool-pipeline-status`, `coaching-tool-admin-basic-auth`, `coaching-tool-pipeline-load-registry`, `coaching-tool-pipeline-process-excel`, `coaching-tool-pipeline-classify`, `coaching-tool-pipeline-chunk`, `coaching-tool-pipeline-ingest-weaviate`, `coaching-tool-pipeline-summarize-case-study`, `coaching-tool-pipeline-ingest-case-study`, `coaching-tool-pipeline-clear-collections`, `coaching-tool-pipeline-update-status` |
| Lambda Layer | 1 | `coaching-tool-shared` |
| API Gateway REST API | 1 | `CoachingToolApi` |
| Step Functions State Machine | 1 | `CoachingTool-IngestionPipeline` |
| IAM Role | ~22 | One per Lambda + Step Functions + API Gateway |
| CloudWatch Alarm | 5 | Error rate, latency, 5xx, pipeline failures, DynamoDB throttling |
| SNS Topic | 1 | Alarm notifications |

**All resources are tagged with:**
- `Environment: non-prod`
- `Project: coaching-tool`

---

## 4. Recommended IAM Policy (Consolidated)

If granting a single policy, the minimum managed-policy equivalent:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CDKBootstrapAndDeploy",
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "s3:*",
        "lambda:*",
        "apigateway:*",
        "dynamodb:*",
        "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:PassRole",
        "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy",
        "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:TagRole",
        "cloudfront:*",
        "states:*",
        "secretsmanager:*",
        "sns:*",
        "cloudwatch:PutMetricAlarm", "cloudwatch:DeleteAlarms", "cloudwatch:DescribeAlarms",
        "logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:PutRetentionPolicy",
        "ecr:*",
        "ssm:GetParameter", "ssm:PutParameter",
        "sts:AssumeRole", "sts:GetCallerIdentity"
      ],
      "Resource": "*"
    }
  ]
}
```

> **Note:** For tighter security, each action group can be scoped to specific resource ARNs as detailed in Section 2 above.

---

## 5. What External Services Are Used (Not AWS)

| Service | Purpose | Auth Method |
|---------|---------|-------------|
| OpenAI API | LLM inference (chatbot, classification, scoring) | API key stored in Secrets Manager |
| Weaviate Cloud (GCP) | Vector database for RAG search | API key stored in Secrets Manager |

These are existing dependencies — no new external services are introduced.
