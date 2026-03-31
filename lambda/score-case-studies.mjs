// lambda/score-case-studies.mjs
// POST /api/score-case-studies handler.
// Multi-query nearText retrieval + single LLM batch scoring.

const LIB_PATH = process.env.AWS_LAMBDA_FUNCTION_NAME ? '/opt/nodejs' : '..';

const { weaviateClient, openaiClient } = await import(`${LIB_PATH}/lib/weaviate-client.mjs`);
const { SCORE_CASE_STUDIES_PROMPT } = await import(`${LIB_PATH}/prompts/load.mjs`);

const MODEL = process.env.CHATBOT_MODEL || 'gpt-5.1';

const CS_SUMMARY_FIELDS =
  'document_id title source_label source_url doc_date summary location timeframe demographic scale tags key_outcomes implementation_steps';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Nesta query groups for semantic search ──────────────────

const NESTA_QUERY_GROUPS = [
  { label: 'goals+outcomes',       keys: [1] },
  { label: 'participants+reach',   keys: [2, 3] },
  { label: 'tasks+workflow',       keys: [6, 7] },
  { label: 'ownership+evaluation', keys: [4, 8, 9] },
];

const NEAR_TEXT_LIMIT = 50;
const MAX_CANDIDATES = 80;

const QUESTION_LABELS = {
  1: 'Project goals',
  2: 'Target participants',
  3: 'Participant reach',
  4: 'Process ownership',
  5: 'Participation incentives',
  6: 'Defined tasks',
  7: 'Workflow',
  8: 'Input evaluation',
  9: 'Use of outputs',
};

// ── Helpers ─────────────────────────────────────────────────

function mapCaseStudy(hit) {
  return {
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
}

function buildSearchQueries(nestaResponses) {
  return NESTA_QUERY_GROUPS
    .map(({ label, keys }) => {
      const text = keys
        .map((k) => (nestaResponses[k] || '').trim())
        .filter(Boolean)
        .join(' ');
      return text ? { label, text: text.slice(0, 300) } : null;
    })
    .filter(Boolean);
}

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

// ── Lambda handler ──────────────────────────────────────────

export const handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS' || event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});
    const { nestaResponses } = body;

    if (!nestaResponses || typeof nestaResponses !== 'object') {
      return errorResponse(400, 'Missing required field: nestaResponses.');
    }

    const startTime = Date.now();
    console.log('\n[score-case-studies] -- Request received --');

    // 1. Build 3-4 queries from Nesta responses
    const queries = buildSearchQueries(nestaResponses);
    console.log(`[score-case-studies] Built ${queries.length} queries: ${queries.map((q) => q.label).join(', ')}`);

    if (queries.length === 0) {
      return errorResponse(400, 'No usable responses to build search queries.');
    }

    // 2. Run parallel nearText queries against CaseStudyLibrary
    const weaviateStart = Date.now();
    const results = await Promise.all(
      queries.map((q) =>
        weaviateClient.graphql
          .get()
          .withClassName('CaseStudyLibrary')
          .withFields(CS_SUMMARY_FIELDS)
          .withNearText({ concepts: [q.text] })
          .withLimit(NEAR_TEXT_LIMIT)
          .do()
          .then((r) => {
            const hits = r?.data?.Get?.CaseStudyLibrary ?? [];
            console.log(`[score-case-studies]   ${q.label}: ${hits.length} hits`);
            return hits;
          }),
      ),
    );
    console.log(`[score-case-studies] Weaviate queries took ${Date.now() - weaviateStart}ms`);

    // 3. Merge and dedupe by document_id, keep top MAX_CANDIDATES
    const seen = new Set();
    const candidates = [];
    for (const hits of results) {
      for (const hit of hits) {
        if (!hit.document_id || seen.has(hit.document_id)) continue;
        seen.add(hit.document_id);
        candidates.push(hit);
        if (candidates.length >= MAX_CANDIDATES) break;
      }
      if (candidates.length >= MAX_CANDIDATES) break;
    }
    console.log(`[score-case-studies] ${candidates.length} unique candidates after merge/dedupe`);

    // 4. Build the practitioner context from all Nesta answers
    const contextLines = Object.entries(nestaResponses)
      .filter(([, v]) => v && v.trim())
      .map(([k, v]) => `- ${QUESTION_LABELS[k] || `Q${k}`}: ${v.trim()}`)
      .join('\n');

    const caseStudyList = candidates
      .map(
        (cs) =>
          `- ID: ${cs.document_id} | Title: "${cs.title}" | Location: ${cs.location || 'N/A'} | Scale: ${cs.scale || 'N/A'} | ` +
          `Timeframe: ${cs.timeframe || 'N/A'} | Demographic: ${cs.demographic || 'N/A'} | Tags: ${(cs.tags || []).join(', ')} | ` +
          `Summary: ${cs.summary || ''}`,
      )
      .join('\n');

    const userMessage = [
      'Score the following case studies for relevance to this practitioner\'s situation.',
      '',
      '## Practitioner Context',
      contextLines,
      '',
      '## Case Studies to Score',
      caseStudyList,
    ].join('\n');

    // 5. Single LLM call with rubric
    const llmStart = Date.now();
    console.log(`[score-case-studies] Calling LLM (model: ${MODEL}) with ${candidates.length} candidates...`);

    const completion = await openaiClient.chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SCORE_CASE_STUDIES_PROMPT },
        { role: 'user', content: userMessage },
      ],
    });

    const llmMs = Date.now() - llmStart;
    console.log(`[score-case-studies] LLM completed in ${llmMs}ms`);

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      console.error('[score-case-studies] LLM returned no content');
      return errorResponse(500, 'LLM returned no response.');
    }

    let scores;
    try {
      const parsed = JSON.parse(raw);
      scores = Array.isArray(parsed) ? parsed : parsed.scores || parsed.results || [];
    } catch {
      console.error('[score-case-studies] Failed to parse LLM JSON:', raw);
      return errorResponse(500, 'Failed to parse scoring response.');
    }

    // 6. Merge scores with full case study metadata and return top results
    const scoreMap = new Map(scores.map((s) => [s.id, s]));
    const scoredCaseStudies = candidates
      .filter((cs) => scoreMap.has(cs.document_id))
      .map((cs) => {
        const s = scoreMap.get(cs.document_id);
        return {
          ...mapCaseStudy(cs),
          relevancyScore: s.score,
          relevancyReason: s.reason,
        };
      })
      .sort((a, b) => b.relevancyScore - a.relevancyScore);

    console.log(`[score-case-studies] -- Results (${scoredCaseStudies.length} scored) --`);
    scoredCaseStudies.slice(0, 10).forEach((s, i) => {
      console.log(`  ${i + 1}. [${s.relevancyScore}] ${s.id} -- ${s.relevancyReason}`);
    });
    console.log(`[score-case-studies] Total time: ${Date.now() - startTime}ms\n`);

    return jsonResponse({ scoredCaseStudies });
  } catch (error) {
    console.error('[score-case-studies] Error:', error);
    return errorResponse(500, 'Failed to score case studies.');
  }
};
