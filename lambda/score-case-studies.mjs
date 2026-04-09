// lambda/score-case-studies.mjs
//
// RETIRED. This Lambda used to handle POST /api/score-case-studies, a legacy
// endpoint that scored case studies against a practitioner's Nesta framework
// answers. It has no remaining frontend caller — API.scoreCaseStudies is
// declared in src/api-config.ts but never invoked by any mounted component —
// and the prompt it used (score-case-studies.txt) has been deleted from the
// prompts/ folder.
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

  return {
    statusCode: 410,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      error: 'Endpoint retired',
      message: 'The /api/score-case-studies endpoint has been retired. Case study relevance is now surfaced through the unified /api/chat coaching interface.',
    }),
  };
};
