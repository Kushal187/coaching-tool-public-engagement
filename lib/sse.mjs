// lib/sse.mjs
// Shared SSE response helpers for Netlify Functions.

export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

export function sseHeaders() {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    ...corsHeaders(),
  };
}

export function handleCors(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  return null;
}

export function formatSSEChunk(content) {
  return `data: ${JSON.stringify({ content })}\n\n`;
}

export function formatSSESources(sourceDocuments) {
  return `data: ${JSON.stringify({ sources: sourceDocuments })}\n\n`;
}

export function formatSSEDone() {
  return 'data: [DONE]\n\n';
}

export function sseResponse(body) {
  return { statusCode: 200, headers: sseHeaders(), body };
}

export function jsonResponse(data, statusCode = 200) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(data),
  };
}

export function errorResponse(statusCode, message) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify({ error: message }),
  };
}
