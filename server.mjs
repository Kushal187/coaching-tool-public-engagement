// server.mjs
// Express server replacing Netlify Functions. True SSE streaming,
// no serverless timeout constraints.

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { openaiClient, weaviateClient } from './lib/weaviate-client.mjs';
import { searchKnowledgeBase, formatSearchResultsAsContext } from './lib/agent-tools.mjs';
import { formatSSEChunk, formatSSEDone } from './lib/sse.mjs';
import adminRoutes from './lib/admin-routes.mjs';
import { GENERATE_REFLECTION_PROMPT, GENERAL_PROMPT } from './prompts/load.mjs';
import { routeMessage } from './lib/orchestrator.mjs';
import { getOrCreateSession, getSession, deleteSession, getSessionSummary } from './lib/session-state.mjs';
import { coachResponse } from './lib/coach-agent.mjs';
import { retrievalResponse } from './lib/retrieval-agent.mjs';
import { handleSuggestNext } from './lib/suggest-next.mjs';
import { NESTA_QUESTIONS } from './lib/nesta-questions.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.CHATBOT_MODEL || 'gpt-5.1';

app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Shared Helpers ──────────────────────────────────────────

function initSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

// ── Case study helpers (shared by list endpoint) ─────────────

const CS_COLLECTION = 'CaseStudyLibrary';
const CS_SUMMARY_FIELDS =
  'document_id title source_label source_url doc_date summary location timeframe demographic scale tags key_outcomes implementation_steps';
const CS_FULL_FIELDS = CS_SUMMARY_FIELDS + ' full_content';

function mapCaseStudy(hit, includeFull) {
  const mapped = {
    id: hit.document_id,
    title: hit.title || 'Untitled',
    location: hit.location || 'Not specified',
    timeframe: hit.timeframe || 'Not specified',
    demographic: hit.demographic || 'Not specified',
    scale: hit.scale || 'medium',
    tags: hit.tags || [],
    summary: hit.summary || '',
    keyOutcomes: hit.key_outcomes || [],
    implementationSteps: hit.implementation_steps || [],
    sourceUrl: hit.source_url || '',
    sourceLabel: hit.source_label || '',
    docDate: hit.doc_date || '',
  };
  if (includeFull) {
    mapped.fullContent = hit.full_content || '';
  }
  return mapped;
}

// ── GET /api/sources ────────────────────────────────────────
// Public endpoint returning deduplicated knowledge base sources
// for the About page transparency section.

app.get('/api/sources', async (_req, res) => {
  try {
    const result = await weaviateClient.graphql
      .get()
      .withClassName('CoachingTool')
      .withFields('doc_name source_label source_url content_type doc_date')
      .withLimit(500)
      .do();

    const hits = result?.data?.Get?.CoachingTool ?? [];

    const seen = new Map();
    for (const h of hits) {
      const key = h.source_label || h.doc_name;
      if (!key || seen.has(key)) continue;
      seen.set(key, {
        name: h.source_label || h.doc_name || 'Untitled',
        url: h.source_url || '',
        contentType: h.content_type || 'other',
        date: h.doc_date || '',
      });
    }

    const sources = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));

    // Override URLs that point to individual pages rather than the source itself
    for (const s of sources) {
      if (s.url.includes('participedia.net/case/')) {
        s.url = 'https://participedia.net';
      }
    }

    res.json(sources);
  } catch (err) {
    console.error('[sources] Error:', err.message);
    res.status(500).json({ error: 'Failed to load sources.' });
  }
});

// ── GET /api/case-studies ───────────────────────────────────

app.get('/api/case-studies', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.query.id) {
      const result = await weaviateClient.graphql
        .get()
        .withClassName(CS_COLLECTION)
        .withFields(CS_FULL_FIELDS)
        .withWhere({
          path: ['document_id'],
          operator: 'Equal',
          valueText: req.query.id,
        })
        .withLimit(1)
        .do();

      const hits = result?.data?.Get?.[CS_COLLECTION] ?? [];
      if (hits.length === 0) {
        return res.status(404).json({ error: 'Case study not found.' });
      }
      return res.json(mapCaseStudy(hits[0], true));
    }

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let hits;

    if (q) {
      console.log(`[case-studies] search q="${q}"`);
      try {
        const searchResult = await weaviateClient.graphql
          .get()
          .withClassName(CS_COLLECTION)
          .withFields(CS_SUMMARY_FIELDS)
          .withNearText({ concepts: [q] })
          .withLimit(50)
          .do();
        hits = searchResult?.data?.Get?.[CS_COLLECTION] ?? [];
        console.log(`[case-studies] nearText search → ${hits.length} hit(s)`);
        hits.slice(0, 5).forEach((h, i) =>
          console.log(`  ${i + 1}. ${h.title}`),
        );
      } catch (searchErr) {
        console.error('[case-studies] nearText search failed, falling back to hybrid:', searchErr.message);
        try {
          const fallback = await weaviateClient.graphql
            .get()
            .withClassName(CS_COLLECTION)
            .withFields(CS_SUMMARY_FIELDS)
            .withHybrid({ query: q, alpha: 0.75 })
            .withLimit(50)
            .do();
          hits = fallback?.data?.Get?.[CS_COLLECTION] ?? [];
          console.log(`[case-studies] hybrid fallback → ${hits.length} hit(s)`);
        } catch (hybridErr) {
          console.error('[case-studies] hybrid fallback also failed:', hybridErr.message);
          hits = [];
        }
      }
    } else {
      const result = await weaviateClient.graphql
        .get()
        .withClassName(CS_COLLECTION)
        .withFields(CS_SUMMARY_FIELDS)
        .withLimit(200)
        .do();
      hits = result?.data?.Get?.[CS_COLLECTION] ?? [];
    }

    const seen = new Set();
    let items = hits
      .map((h) => mapCaseStudy(h, false))
      .filter((cs) => {
        if (seen.has(cs.id)) return false;
        seen.add(cs.id);
        return true;
      });

    if (req.query.scale) {
      const scale = req.query.scale.toLowerCase();
      items = items.filter((cs) => cs.scale === scale);
    }
    if (req.query.tag) {
      const tag = req.query.tag.toLowerCase();
      items = items.filter((cs) =>
        cs.tags.some((t) => t.toLowerCase().includes(tag)),
      );
    }

    res.json(items);
  } catch (error) {
    console.error('case-studies error:', error);
    res.status(500).json({ error: 'Failed to fetch case studies.' });
  }
});

// ── POST /api/chat ─────────────────────────────────────────
// Unified chat endpoint. Single entry point for the conversational
// coaching interface. Manages sessions, routes via orchestrator,
// dispatches to coach/retrieval/suggest/general agents, and streams
// responses back via SSE.

app.post('/api/chat', async (req, res) => {
  const { sessionId, message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Missing "message" in request body.' });
  }

  const sid = sessionId || `auto-${Date.now()}`;
  const session = getOrCreateSession(sid);

  try {
    // 1. Route the message via the orchestrator
    const routing = await routeMessage(message, session);

    // 2. Record user message in conversation history
    session.conversationHistory.push({
      role: 'user',
      content: message,
      metadata: { routing: routing.decision },
    });

    // 3. Dispatch to the appropriate handler
    let result;

    switch (routing.handler) {
      case 'coach': {
        const qId = routing.questionId || session.activeQuestionId || 1;
        session.activeQuestionId = qId;
        result = await coachResponse(qId, message, session, routing.decision.action);

        // Auto-trigger suggestions when a question is resolved
        if (result.resolved) {
          try {
            const suggestResult = await handleSuggestNext(session, qId);
            // Append suggestion text to the coach's affirmation message
            result.message = result.message + '\n\n---\n\n' + suggestResult.message;
            result.suggestions = suggestResult.suggestions;
            console.log(`[chat] Auto-suggesting next questions after Q${qId} resolved`);
          } catch (err) {
            console.error('[chat] Failed to auto-suggest after resolution:', err.message);
            // Non-fatal: the coach's resolution message still goes through
          }
        }
        break;
      }

      case 'retrieval': {
        result = await retrievalResponse(message, session);
        break;
      }

      case 'suggest': {
        result = await handleSuggestNext(session);
        break;
      }

      case 'general':
      default: {
        result = await handleGeneralMessage(message, session);
        break;
      }
    }

    // 4. Record assistant message in conversation history
    session.conversationHistory.push({
      role: 'assistant',
      content: result.message,
      metadata: {
        handler: routing.handler,
        questionId: routing.questionId,
        resolved: result.resolved || false,
      },
    });

    // 5. Stream response via SSE
    console.log(`[chat] sources: ${JSON.stringify((result.sources || []).slice(0, 2).map(s => ({ title: s.title?.slice(0, 40), sf: s.sourceFile?.slice(0, 40), url: !!s.sourceUrl })))}`);
    initSSE(res);
    res.write(formatSSEChunk(result.message));

    // Include metadata so the frontend knows what happened
    res.write(`data: ${JSON.stringify({
      metadata: {
        sessionId: sid,
        handler: routing.handler,
        questionId: routing.questionId,
        resolved: result.resolved || false,
        suggestions: result.suggestions || null,
        sources: result.sources || [],
        sessionSummary: getSessionSummary(session),
      },
    })}\n\n`);

    res.write(formatSSEDone());
    res.end();

    console.log(`[chat] ${sid} | ${routing.handler}(Q${routing.questionId ?? '-'}) | ${message.slice(0, 50)}...`);
  } catch (error) {
    console.error('[chat] Error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'An error occurred processing your message.' });
    }
    res.end();
  }
});

// ── /api/chat handler: general messages ────────────────────

async function handleGeneralMessage(message, session) {
  const summary = getSessionSummary(session);

  // Describe the active question (if any) in a way the prompt can reference
  const activeQuestion = summary.activeQuestionId
    ? `Q${summary.activeQuestionId} — "${NESTA_QUESTIONS.find((q) => q.id === summary.activeQuestionId)?.question ?? ''}"`
    : 'None';

  const systemContent = GENERAL_PROMPT
    .replaceAll('{{addressedCount}}', String(summary.addressedCount))
    .replaceAll('{{inProgressCount}}', String(summary.inProgressCount))
    .replaceAll('{{activeQuestion}}', activeQuestion);

  const response = await openaiClient.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: message },
    ],
  });

  return {
    message: response.choices[0]?.message?.content || "Hello! What public engagement challenge are you working on today?",
    type: 'general',
  };
}

// ── Unified Chat: Orchestrator Test Endpoint ───────────────
// Temporary endpoint for testing Phase 1 (orchestrator routing).
// POST /api/chat/test-route — returns the routing decision without
// dispatching to any agent.

app.post('/api/chat/test-route', async (req, res) => {
  const { sessionId, message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Missing "message" in request body.' });
  }

  try {
    const session = getOrCreateSession(sessionId || 'test-session');
    const routing = await routeMessage(message, session);

    return res.json({
      routing,
      sessionSummary: getSessionSummary(session),
    });
  } catch (error) {
    console.error('[chat/test-route] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/chat/session/:id — inspect session state
app.get('/api/chat/session/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  return res.json(getSessionSummary(session));
});

// DELETE /api/chat/session/:id — clear a session
app.delete('/api/chat/session/:id', (req, res) => {
  const deleted = deleteSession(req.params.id);
  return res.json({ deleted });
});

// ── POST /api/chat/reflection ─────────────────────────────
// Generate a reflection from the unified chat session state.
// Pulls user responses and coaching conversations from the session
// instead of from the legacy form-based sessionStorage.

app.post('/api/chat/reflection', async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing "sessionId" in request body.' });
  }

  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  const summary = getSessionSummary(session);
  if (summary.addressedCount < 1) {
    return res.status(400).json({ error: 'No questions have been addressed yet.' });
  }

  try {
    const lines = [
      'Generate an in-depth reflection for the following Nesta framework coaching journey.',
      '',
      '## Coaching Conversations and Progress',
      '',
    ];

    for (const q of NESTA_QUESTIONS) {
      const qs = session.questions[q.id];
      lines.push(`### Question ${q.id}: ${q.question}`);
      lines.push(`**Status:** ${qs.status}`);

      if (qs.userResponse) {
        lines.push(`**Summarized Response:** ${qs.userResponse}`);
      }
      if (qs.gap) {
        lines.push(`**Identified Gap:** ${qs.gap}`);
      }

      const history = qs.coachingHistory || [];
      const userMessages = history.filter((m) => m.role === 'user');

      if (history.length > 1 && userMessages.length > 0) {
        if (qs.status === 'addressed') {
          lines.push('**Coaching:** PRODUCTIVE CONVERSATION — The user engaged with the coach and resolved this item.');
        } else {
          lines.push('**Coaching:** UNRESOLVED WITH ACTIVE CONVERSATION — The user engaged with the coach but has not yet resolved this item.');
        }
        lines.push('**Conversation Summary:**');
        for (const msg of history) {
          if (msg.role === 'user') {
            lines.push(`  User: ${msg.content}`);
          } else {
            const preview = msg.content.length > 500 ? msg.content.slice(0, 500) + '...' : msg.content;
            lines.push(`  Coach: ${preview}`);
          }
        }
      } else if (qs.status === 'addressed') {
        lines.push('**Coaching:** RESOLVED WITHOUT EXTENDED CONVERSATION — The user addressed this question without a long coaching exchange.');
      } else {
        lines.push('**Coaching:** NO COACHING SESSION — No conversation occurred and this item remains unresolved.');
      }

      lines.push('');
    }

    // Pre-fetch knowledge base evidence in parallel (avoids multi-iteration agent loop)
    const searchQueries = NESTA_QUESTIONS.map((q) => {
      const qs = session.questions[q.id];
      const parts = [q.question];
      if (qs.gap) parts.push(qs.gap);
      return searchKnowledgeBase({ query: parts.join(' — ') });
    });

    const searchResults = await Promise.all(searchQueries);
    const allHits = searchResults.flatMap((r) => r.results || []);

    // Deduplicate by documentId + chunkIndex
    const seen = new Set();
    const uniqueHits = allHits.filter((h) => {
      const key = `${h.documentId}:${h.chunkIndex}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    lines.push('## Relevant Knowledge Base Evidence');
    lines.push('');
    lines.push(formatSearchResultsAsContext(uniqueHits));
    lines.push('');
    lines.push('Please produce a comprehensive, evidence-grounded reflection in the required JSON format. Factor in the coaching conversations — acknowledge growth, flag skipped coaching, and note unresolved items.');

    const userMessage = lines.join('\n');

    // Single LLM call — evidence is pre-fetched so no agent loop needed
    const response = await openaiClient.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: GENERATE_REFLECTION_PROMPT },
        { role: 'user', content: userMessage },
      ],
    });

    const result = response.choices[0].message.content;

    let parsed;
    try {
      const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('Failed to parse chat reflection response as JSON:', result);
      return res.status(500).json({ error: 'Failed to parse reflection.' });
    }

    if (!parsed.reflection) {
      return res.status(500).json({ error: 'Invalid reflection format.' });
    }

    res.json(parsed);
  } catch (error) {
    console.error('Error generating chat reflection:', error);
    res.status(500).json({ error: 'Failed to generate reflection.' });
  }
});

// ── Unified Chat: Coach Agent Test Endpoint ────────────────
// POST /api/chat/test-coach — test the coach agent directly.
// Requires a sessionId and questionId to coach on.

app.post('/api/chat/test-coach', async (req, res) => {
  const { sessionId, questionId, message } = req.body;

  if (!message || !questionId) {
    return res.status(400).json({ error: 'Missing "message" or "questionId" in request body.' });
  }

  try {
    const session = getOrCreateSession(sessionId || 'test-coach-session');
    const result = await coachResponse(questionId, message, session);

    return res.json({
      result,
      sessionSummary: getSessionSummary(session),
    });
  } catch (error) {
    console.error('[chat/test-coach] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ── Unified Chat: Retrieval Agent Test Endpoint ────────────
// POST /api/chat/test-retrieve — test the retrieval agent directly.

app.post('/api/chat/test-retrieve', async (req, res) => {
  const { sessionId, message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Missing "message" in request body.' });
  }

  try {
    const session = getOrCreateSession(sessionId || 'test-retrieve-session');
    const result = await retrievalResponse(message, session);

    return res.json({ result });
  } catch (error) {
    console.error('[chat/test-retrieve] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ── Admin API ───────────────────────────────────────────────

app.use('/api/admin', adminRoutes);

// ── Static Files (production) ───────────────────────────────

app.use(express.static(path.join(__dirname, 'dist')));
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
