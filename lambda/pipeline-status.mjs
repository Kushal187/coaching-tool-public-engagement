// lambda/pipeline-status.mjs
// GET /api/admin/pipeline/status - reads from DynamoDB PipelineRuns.

const PIPELINE_RUNS_TABLE = process.env.PIPELINE_RUNS_TABLE || 'CoachingToolPipelineRuns';

let dynamoDb;

if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');
  const client = new DynamoDBClient({});
  dynamoDb = DynamoDBDocumentClient.from(client);
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
    if (!dynamoDb) {
      return jsonResponse({
        running: false,
        lastRun: null,
        lastResult: null,
        message: 'DynamoDB not configured.',
      });
    }

    // Get the most recent pipeline runs, sorted by startedAt descending
    const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
    const result = await dynamoDb.send(new ScanCommand({
      TableName: PIPELINE_RUNS_TABLE,
      Limit: 20,
    }));

    const runs = (result.Items || []).sort(
      (a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0),
    );

    const latest = runs[0] || null;
    const isRunning = latest?.status === 'STARTED' || latest?.status === 'RUNNING';

    // If the latest run has a Step Functions execution ARN, check its status
    if (isRunning && latest?.executionArn) {
      try {
        const { SFNClient, DescribeExecutionCommand } = await import('@aws-sdk/client-sfn');
        const sfn = new SFNClient({});
        const execution = await sfn.send(new DescribeExecutionCommand({
          executionArn: latest.executionArn,
        }));

        const sfnStatus = execution.status; // RUNNING, SUCCEEDED, FAILED, TIMED_OUT, ABORTED

        if (sfnStatus !== 'RUNNING') {
          // Update DynamoDB with the final status
          const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
          const mappedStatus = sfnStatus === 'SUCCEEDED' ? 'COMPLETED' : sfnStatus;
          await dynamoDb.send(new UpdateCommand({
            TableName: PIPELINE_RUNS_TABLE,
            Key: { id: latest.id },
            UpdateExpression: 'SET #s = :status, updatedAt = :now',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
              ':status': mappedStatus,
              ':now': new Date().toISOString(),
            },
          }));
          latest.status = mappedStatus;
        }
      } catch (sfnErr) {
        console.warn('Failed to check Step Functions execution:', sfnErr.message);
      }
    }

    return jsonResponse({
      running: latest?.status === 'STARTED' || latest?.status === 'RUNNING',
      lastRun: latest?.startedAt || null,
      lastResult: latest || null,
      recentRuns: runs.slice(0, 10),
    });
  } catch (error) {
    console.error('Pipeline status error:', error);
    return errorResponse(500, 'Failed to fetch pipeline status.');
  }
};
