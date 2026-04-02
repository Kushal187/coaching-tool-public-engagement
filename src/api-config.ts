// API endpoint configuration.
// LLM endpoints use Lambda Function URLs directly to avoid CloudFront's 60s timeout.
// Non-LLM endpoints use relative paths (routed via CloudFront -> API Gateway).
//
// When calling a Function URL directly, the Lambda needs to know which route to dispatch to.
// The `_route` field is included in POST bodies for this purpose.

const AGENT_JSON_URL = import.meta.env.VITE_AGENT_JSON_URL || '';
const LLM_JSON_URL = import.meta.env.VITE_LLM_JSON_URL || '';
const CHATBOT_URL = import.meta.env.VITE_CHATBOT_URL || '';
const SCORE_CS_URL = import.meta.env.VITE_SCORE_CS_URL || '';

interface Endpoint {
  url: string;
  /** Included as `_route` in POST body when calling Function URLs directly */
  route?: string;
}

function llmEndpoint(fnUrl: string, route: string, fallbackPath: string): Endpoint {
  if (fnUrl) return { url: fnUrl, route };
  return { url: fallbackPath };
}

export const API = {
  chatbot: llmEndpoint(CHATBOT_URL, '/api/chatbot', '/api/chatbot'),
  generateQuestions: llmEndpoint(AGENT_JSON_URL, '/api/generate-questions', '/api/generate-questions'),
  evaluateAssessment: llmEndpoint(AGENT_JSON_URL, '/api/evaluate-assessment', '/api/evaluate-assessment'),
  generateReflection: llmEndpoint(AGENT_JSON_URL, '/api/generate-reflection', '/api/generate-reflection'),
  analyzeCrossResolution: llmEndpoint(LLM_JSON_URL, '/api/analyze-cross-resolution', '/api/analyze-cross-resolution'),
  scoreCaseStudies: llmEndpoint(SCORE_CS_URL, '/api/score-case-studies', '/api/score-case-studies'),
  // Unified coaching chat
  chat: { url: '/api/chat' },
  chatSession: { url: '/api/chat/session' },
  chatReflection: llmEndpoint(AGENT_JSON_URL, '/api/chat/reflection', '/api/chat/reflection'),
  // Non-LLM endpoints (always relative, via CloudFront -> API Gateway)
  caseStudies: { url: '/api/case-studies' },
  adminStats: { url: '/api/admin/stats' },
  adminDocuments: { url: '/api/admin/documents' },
  adminRegistry: { url: '/api/admin/registry' },
  adminClassify: { url: '/api/admin/classify' },
  adminIngestText: { url: '/api/admin/ingest/text' },
  adminIngestUrl: { url: '/api/admin/ingest/url' },
  adminIngestPdfConvert: { url: '/api/admin/ingest/pdf/convert' },
  adminIngestPdfConfirm: { url: '/api/admin/ingest/pdf/confirm' },
  adminPipelineRun: { url: '/api/admin/pipeline/run' },
  adminPipelineStatus: { url: '/api/admin/pipeline/status' },
};

/**
 * Helper: build fetch options for a POST to an LLM endpoint.
 * Automatically injects `_route` when calling a Function URL.
 */
export function postBody(endpoint: Endpoint, data: Record<string, unknown>): [string, RequestInit] {
  const body = endpoint.route ? { ...data, _route: endpoint.route } : data;
  return [
    endpoint.url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  ];
}
