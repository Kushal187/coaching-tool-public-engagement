// lambda/chatbot-stream.mjs
//
// RETIRED. This Lambda used to handle three legacy LLM endpoints:
//   POST /api/chatbot
//   POST /api/generate-plan
//   POST /api/adapt-case-study
//
// All three endpoints have been removed from the frontend (see src/api-config.ts
// and the router in src/routes.ts — ChatBot.tsx is no longer mounted and no
// component calls /api/generate-plan or /api/adapt-case-study). The prompts
// they used (chatbot.txt, generate-plan.txt, adapt-case-study.txt,
// evaluate-coaching.txt) have been deleted from the prompts/ folder.
//
// The file is kept as a stub because CDK still references it as a Lambda
// asset in cdk/lib/coaching-tool-stack.ts. The stub handler returns HTTP 410
// Gone for any invocation so that, if the retired routes are ever hit, the
// caller gets a clear signal rather than a ReferenceError.

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function goneResponse(routePath) {
  return {
    statusCode: 410,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      error: 'Endpoint retired',
      message: `The endpoint ${routePath || '(unknown)'} has been retired. Use /api/chat for the unified coaching interface.`,
    }),
  };
}

// Detect streaming Lambda environment. When awslambda.streamifyResponse is
// available we wrap the stub in a streaming handler to match the original
// Function URL contract; otherwise we export a plain request/response handler
// that also satisfies API Gateway invocations.
const streamify = globalThis.awslambda?.streamifyResponse;

export const handler = streamify
  ? streamify(async (event, responseStream) => {
      const metadata = {
        statusCode: 410,
        headers: CORS_HEADERS,
      };
      // eslint-disable-next-line no-undef
      const wrapped = globalThis.awslambda.HttpResponseStream.from(responseStream, metadata);
      const body = typeof event?.body === 'string' ? JSON.parse(event.body) : (event?.body || {});
      const routePath = body._route || event?.rawPath || event?.path || '';
      wrapped.write(JSON.stringify({
        error: 'Endpoint retired',
        message: `The endpoint ${routePath || '(unknown)'} has been retired. Use /api/chat for the unified coaching interface.`,
      }));
      wrapped.end();
    })
  : async (event) => {
      if (event?.httpMethod === 'OPTIONS' || event?.requestContext?.http?.method === 'OPTIONS') {
        return { statusCode: 204, headers: CORS_HEADERS, body: '' };
      }
      const body = typeof event?.body === 'string' ? JSON.parse(event.body) : (event?.body || {});
      const routePath = body._route || event?.rawPath || event?.path || '';
      return goneResponse(routePath);
    };
