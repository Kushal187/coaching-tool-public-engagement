// netlify/functions/chatbot.mjs
// Agentic RAG chatbot with multi-step retrieval and citation enforcement.

import {
  agentToolDefinitions,
  agentToolImplementations,
  buildSourceDocuments,
} from '../../lib/agent-tools.mjs';
import { resolveAgentToolCalls, streamFinalResponse } from '../../lib/agent-runner.mjs';
import {
  handleCors,
  formatSSEChunk,
  formatSSESources,
  formatSSEDone,
  sseResponse,
  errorResponse,
} from '../../lib/sse.mjs';

const MODEL = process.env.CHATBOT_MODEL || 'gpt-4.1';
const MAX_ITERATIONS = 3;

const SYSTEM_PROMPT = `You are a knowledgeable public engagement assistant with access to a curated knowledge base of documents about participatory democracy, community engagement, and deliberative processes.

You have tools to search the knowledge base. Use them to find relevant evidence before answering.

RULES:
- You MUST use your search tools to find relevant information before making any recommendation or providing detailed guidance.
- Search at least once, and search again with different queries if the first results are insufficient.
- Every specific method, tool, or approach you recommend MUST cite its source inline: [Source: Document Name]
- If you cannot find relevant evidence for a particular aspect, explicitly state: "Based on available resources, I don't have specific guidance on this."
- Do NOT recommend anything you cannot ground in a retrieved document or widely accepted public engagement knowledge.
- Use markdown formatting (bullet points, bold, headers) to make your answers clear and readable.
- Keep answers concise unless the user asks for detail.
- When citing sources, use the document name from search results.
- At the end of your response, include a "### Sources" section listing all cited documents.`;

export async function handler(event) {
  const cors = handleCors(event);
  if (cors) return cors;

  if (event.httpMethod !== 'POST') {
    return errorResponse(405, 'Method Not Allowed');
  }

  const { message, conversation } = JSON.parse(event.body || '{}');

  if (!message) {
    return errorResponse(400, 'Missing "message" in request body.');
  }

  try {
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

    if (Array.isArray(conversation)) {
      messages.push(
        ...conversation.slice(0, -1).flatMap((m) => {
          if (m.type === 'user') return { role: 'user', content: m.content };
          if (m.type === 'bot') return { role: 'assistant', content: m.content };
          return [];
        }),
      );
    }

    messages.push({ role: 'user', content: message });

    const { messages: resolvedMessages, earlyContent } = await resolveAgentToolCalls({
      tools: agentToolDefinitions,
      toolImpls: agentToolImplementations,
      model: MODEL,
      maxIterations: MAX_ITERATIONS,
      messages,
    });

    let body = '';

    if (earlyContent) {
      body += formatSSEChunk(earlyContent);
    } else {
      body += await streamFinalResponse({ messages: resolvedMessages, model: MODEL });
    }

    const allSources = collectSourcesFromMessages(resolvedMessages);
    if (allSources.length > 0) {
      body += formatSSESources(buildSourceDocuments(allSources));
    }
    body += formatSSEDone();

    return sseResponse(body);
  } catch (error) {
    console.error('Error processing message:', error);
    return errorResponse(500, 'An error occurred processing your message.');
  }
}

/**
 * Extract all search result hits from tool call messages in the conversation.
 */
function collectSourcesFromMessages(messages) {
  const sources = [];
  for (const msg of messages) {
    if (msg.role !== 'tool') continue;
    try {
      const data = JSON.parse(msg.content);
      if (data.results) sources.push(...data.results);
      if (data.chunks) sources.push(...data.chunks);
    } catch { /* skip non-JSON */ }
  }
  return sources;
}
