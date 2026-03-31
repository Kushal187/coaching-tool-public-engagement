// lambda/pipeline-trigger.mjs
// POST /api/admin/pipeline/run - starts Step Functions execution.

const PIPELINE_STATE_MACHINE_ARN = process.env.PIPELINE_STATE_MACHINE_ARN || '';
const PIPELINE_RUNS_TABLE = process.env.PIPELINE_RUNS_TABLE || 'CoachingToolPipelineRuns';

let sfnClient;
let dynamoDb;

if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
  const { SFNClient } = await import('@aws-sdk/client-sfn');
  sfnClient = new SFNClient({});

  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');
  const client = new DynamoDBClient({});
  dynamoDb = DynamoDBDocumentClient.from(client);
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data, statusCode = 200) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(data),
  };
}

function errorResponse(statusCode, message) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: message }),
  };
}

export const handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS' || event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});
    const { mode, source } = body;
    // mode: 'full' | 'incremental' | 'clear'
    // source: 'registry' | 'excel' | 'pdf'

    const runId = `run-${Date.now()}`;
    const startedAt = new Date().toISOString();

    // Record the run in DynamoDB
    if (dynamoDb) {
      const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
      await dynamoDb.send(new PutCommand({
        TableName: PIPELINE_RUNS_TABLE,
        Item: {
          id: runId,
          mode: mode || 'incremental',
          source: source || 'registry',
          status: 'STARTED',
          startedAt,
          updatedAt: startedAt,
        },
      }));
    }

    // Start Step Functions execution
    let executionArn = null;
    if (sfnClient && PIPELINE_STATE_MACHINE_ARN) {
      const { StartExecutionCommand } = await import('@aws-sdk/client-sfn');
      const result = await sfnClient.send(new StartExecutionCommand({
        stateMachineArn: PIPELINE_STATE_MACHINE_ARN,
        input: JSON.stringify({
          runId,
          mode: mode || 'incremental',
          source: source || 'registry',
        }),
        name: runId,
      }));
      executionArn = result.executionArn;

      // Update run record with execution ARN
      if (dynamoDb) {
        const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
        await dynamoDb.send(new UpdateCommand({
          TableName: PIPELINE_RUNS_TABLE,
          Key: { id: runId },
          UpdateExpression: 'SET executionArn = :arn, updatedAt = :now',
          ExpressionAttributeValues: {
            ':arn': executionArn,
            ':now': new Date().toISOString(),
          },
        }));
      }
    } else {
      console.warn('Step Functions not configured. Pipeline not started.');
    }

    return jsonResponse({
      success: true,
      status: {
        running: true,
        runId,
        startedAt,
        mode: mode || 'incremental',
        executionArn,
      },
    });
  } catch (error) {
    console.error('Pipeline trigger error:', error);
    return errorResponse(500, 'Pipeline failed.');
  }
};
