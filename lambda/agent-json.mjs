// lambda/agent-json.mjs
//
// RETIRED. This Lambda used to handle three legacy JSON endpoints:
//   POST /api/generate-questions
//   POST /api/evaluate-assessment
//   POST /api/generate-reflection
//
// All three endpoints have been removed from the live frontend data path
// (see src/api-config.ts — the declarations remain but no mounted component
// calls API.generateQuestions / API.evaluateAssessment / API.generateReflection).
// The live reflection flow now runs through POST /api/chat/reflection in
// server.mjs. The prompts that backed the legacy handlers have been deleted
// from the prompts/ folder except generate-reflection.txt, which is kept
// because server.mjs still uses it for the unified chat reflection route.
//
// The file is kept as a stub because CDK still references it as a Lambda
// asset in cdk/lib/coaching-tool-stack.ts. The stub handler returns HTTP 410
// Gone for any invocation.

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const handler = async (event) => {
  if (event?.httpMethod === 'OPTIONS' || event?.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  const body = typeof event?.body === 'string' ? JSON.parse(event.body) : (event?.body || {});
  const routePath = body._route || event?.path || event?.resource || event?.rawPath || '';

  return {
    statusCode: 410,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      error: 'Endpoint retired',
      message: `The endpoint ${routePath || '(unknown)'} has been retired. Use /api/chat for the unified coaching interface.`,
    }),
  };
};
