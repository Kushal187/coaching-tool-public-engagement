# Unified Coaching Chatbot - Implementation Plan

## Overview

**Goal:** Replace the current two-path UX (manual 9-question form OR scenario-driven testing) with a unified chatbot interface. The user opens a single chat ("What public engagement issues can I help with today?"), types freely, and a multi-agent backend maps their query to the Nesta framework questions, coaches them through each one Socratically, and retrieves evidence from the knowledge base when needed.

**Current State:**
- User fills in 9 Nesta questions in a form (`Coach.tsx`), submits for batch evaluation
- Gets a dashboard (`AssessmentDashboard.tsx`) with per-question coaching chats
- Separate floating chatbot widget (`ChatBot.tsx`) for general Q&A
- Backend: single `/api/chatbot` endpoint + `/api/evaluate-assessment` + per-question coaching via `coaching-context.txt` prompt

**Target State:**
- Single chat interface as the primary entry point
- Orchestrator agent classifies each user message and routes to either Coach Agent or Retrieval Agent
- Coach Agent guides user through Nesta questions one at a time, Socratically
- Retrieval Agent searches knowledge base for evidence/case studies when user is confused or asks for help
- After resolving a question, coach suggests 2-3 related unaddressed questions
- Session tracks progress across all 9 questions

---

## Phase 1: Define the Multi-Agent Architecture & Session State

**Explanation:** Build the foundational data structures and routing logic. Define how the orchestrator decides between coaching and retrieval, how session state tracks which Nesta questions have been addressed, and the message format between agents.

**Complexity:** Medium
**Value:** Critical foundation - everything else depends on this
**Frontend testable:** No (backend-only, tested via API calls / curl)

### Implementation Sketch

#### 1a. Session state schema (`lib/session-state.mjs`)

```js
// In-memory session store (upgrade to Redis/DB later if needed)
const sessions = new Map();

function createSession(sessionId) {
  return {
    id: sessionId,
    createdAt: Date.now(),
    // Track each Nesta question's status
    questions: {
      1: { status: 'not-started', userResponse: '', gap: '', coachingHistory: [] },
      2: { status: 'not-started', userResponse: '', gap: '', coachingHistory: [] },
      // ... through 9
    },
    // Current focus
    activeQuestionId: null,
    // Full conversation for display
    conversationHistory: [],
    // What the orchestrator decided last
    lastRoutingDecision: null,
  };
}

// status values: 'not-started' | 'in-progress' | 'addressed' | 'partial'
```

#### 1b. Orchestrator prompt (`prompts/orchestrator.txt`)

The orchestrator receives the user's message + session state summary and returns a JSON routing decision:

```
You are a routing agent for a public engagement coaching tool based on the Nesta framework.

Given the user's message and the current session state, decide the appropriate action:

ACTIONS:
1. "map_to_question" — The user's message relates to one of the 9 Nesta questions.
   Return which question(s) it maps to so the Coach Agent can begin/continue coaching.
2. "retrieve" — The user is confused, asking for examples, or needs evidence.
   Route to the Retrieval Agent to search the knowledge base.
3. "coach_continue" — The user is responding to a coaching probe. Continue the
   current coaching conversation.
4. "suggest_next" — The current question is resolved. Suggest next questions.
5. "general" — The message is a greeting, off-topic, or meta-question.
   Respond conversationally.

Return JSON: { "action": "...", "questionId": <number|null>, "reasoning": "..." }
```

#### 1c. Orchestrator logic (`lib/orchestrator.mjs`)

```js
export async function routeMessage(userMessage, sessionState) {
  // Build context summary from session state
  const stateSummary = buildStateSummary(sessionState);

  // Call LLM with orchestrator prompt
  const decision = await classifyIntent(userMessage, stateSummary);

  // Route to appropriate handler
  switch (decision.action) {
    case 'map_to_question':
    case 'coach_continue':
      return { handler: 'coach', questionId: decision.questionId, decision };
    case 'retrieve':
      return { handler: 'retrieval', decision };
    case 'suggest_next':
      return { handler: 'suggest', decision };
    case 'general':
      return { handler: 'general', decision };
  }
}
```

---

## Phase 2: Coach Agent (Knowledge-Grounded)

**Explanation:** Build the coaching agent that handles Socratic questioning for a single Nesta question at a time. Critically, the coach agent does NOT coach from generic LLM knowledge — it **always searches the Weaviate knowledge base first** to ground its probing questions, suggestions, and evaluation criteria in real case studies, guides, and best practices from the database. This uses the existing agent tool-calling loop (`runAgentLoop`) with `search_knowledge_base` and `get_document_details` tools, so the coach can retrieve evidence before formulating each response.

**Complexity:** Medium-High
**Value:** High - this is the core coaching experience
**Frontend testable:** No (API-only, test via curl / Postman with session ID)

### Implementation Sketch

#### 2a. Coach Agent prompt (`prompts/coach-agent.txt`)

```
You are a warm, Socratic public engagement coach helping a practitioner work through
the Nesta framework for participatory projects.

You have access to a curated knowledge base of public engagement guides, case studies,
and best practices. You MUST use your search tools to find relevant evidence BEFORE
coaching. Your probing questions, suggestions, and evaluations must be grounded in
what real practitioners and guides recommend — not generic advice.

CURRENT QUESTION: "{{question}}"
QUESTION EXPLANATION: "{{explanation}}"
USER'S RESPONSE SO FAR: "{{userResponse}}"
COACHING HISTORY: {{history}}

YOUR APPROACH:
1. ALWAYS search the knowledge base first for best practices and examples relevant
   to the current question and the user's specific situation.
2. Use what you find to inform your probing — ask questions that push the user toward
   approaches that have worked in real case studies or are recommended in guides.
3. When the user proposes something, evaluate it against evidence from the database,
   not just general reasoning. Cite sources inline: [Source: Document Name].
4. Ask ONE focused probing question at a time to deepen their thinking.
5. Do NOT lecture — guide through questions, but back up your nudges with evidence.
6. When the user gives a concrete, actionable answer that addresses the question
   (measured against best practices from the knowledge base):
   a. Affirm their response clearly
   b. Summarize what they've established
   c. Set resolved = true in your response metadata
7. If they're vague, probe for specifics using examples from the knowledge base
   (e.g., "In [Source: X], practitioners found that identifying specific demographic
   groups early on helped — who specifically are you trying to reach?")
8. Keep responses concise (2-4 sentences + one question)

RULES:
- You MUST search at least once per coaching turn. Search again with different queries
  if the first results are insufficient.
- Every specific method, approach, or best practice you reference MUST cite its source.
- If you cannot find relevant evidence, state that explicitly and still coach based on
  general Nesta framework principles, but flag the gap.

RESPONSE FORMAT (JSON):
{
  "message": "Your coaching response text (markdown OK, with [Source: ...] citations)",
  "resolved": false,
  "confidence": 0.0-1.0,  // how close to resolved
  "probeType": "specificity|feasibility|completeness|affirmation"
}
```

#### 2b. Coach Agent module (`lib/coach-agent.mjs`)

```js
export async function coachResponse(questionId, userMessage, sessionState) {
  const question = NESTA_QUESTIONS[questionId];
  const qState = sessionState.questions[questionId];

  // Build coaching conversation from session state
  const history = qState.coachingHistory;

  // Build messages array with full conversation context
  const messages = buildCoachMessages(question, userMessage, history);

  // Run the agent loop WITH tool-calling — the coach agent searches
  // the knowledge base as part of every response, grounding its
  // probes and evaluation in real evidence from the database.
  const response = await runAgentLoop({
    messages,
    tools: agentToolDefinitions,
    toolImpls: agentToolImplementations,
    model: MODEL,
    maxIterations: DEFAULT_MAX_ITERATIONS,
  });

  // Parse structured JSON from response
  const parsed = parseCoachResponse(response);

  // Update session state
  qState.coachingHistory.push(
    { role: 'user', content: userMessage },
    { role: 'coach', content: parsed.message }
  );

  if (parsed.resolved) {
    qState.status = 'addressed';
    qState.userResponse = summarizeUserResponses(qState.coachingHistory);
  } else if (qState.status === 'not-started') {
    qState.status = 'in-progress';
  }

  return parsed;
}
```

#### 2c. Resolution detection

Reuse existing `cross-resolution.txt` prompt logic, but call it after each coach turn to check if the conversation also resolved other questions.

#### 2d. Key distinction from Retrieval Agent

The Coach Agent and Retrieval Agent both access the knowledge base, but serve different purposes:
- **Coach Agent:** Searches proactively to inform its coaching strategy. Uses evidence to craft better probing questions and evaluate user responses against best practices. The user doesn't see raw search results — they see coaching grounded in evidence.
- **Retrieval Agent:** Searches reactively when the user explicitly asks for help, examples, or is confused. Returns synthesized evidence directly to the user with full source citations.

---

## Phase 3: Retrieval Agent

**Explanation:** Build the retrieval agent that searches the knowledge base (Weaviate) for relevant case studies, guides, and evidence when the user is confused, stuck, or explicitly asks for examples. This agent wraps the existing RAG infrastructure (`agent-tools.mjs`) in a coaching-aware context.

**Complexity:** Low-Medium (builds on existing infrastructure)
**Value:** High - provides evidence-grounded coaching
**Frontend testable:** No (API-only)

### Implementation Sketch

#### 3a. Retrieval Agent prompt (`prompts/retrieval-agent.txt`)

```
You are a research assistant supporting a public engagement coaching session.

The practitioner is working on Nesta question: "{{question}}"
They seem confused or need examples about: "{{userQuery}}"

Search the knowledge base for relevant evidence, case studies, and practical examples.
Then synthesize the findings into a helpful, concise response that:
- Directly addresses what the user is confused about
- Cites specific sources: [Source: Document Name]
- Gives 1-2 concrete examples or approaches
- Frames the information as supportive (not lecturing)
- Ends by connecting back to their specific situation

Keep it to 3-5 paragraphs maximum.
```

#### 3b. Retrieval Agent module (`lib/retrieval-agent.mjs`)

```js
export async function retrievalResponse(userMessage, sessionState) {
  const activeQ = sessionState.activeQuestionId;
  const question = activeQ ? NESTA_QUESTIONS[activeQ] : null;

  // Use existing agent tool-calling loop with search tools
  const response = await runAgentLoop({
    systemPrompt: buildRetrievalPrompt(question),
    userMessage,
    tools: agentToolDefinitions,
    toolImpls: agentToolImplementations,
  });

  return {
    message: response,
    type: 'retrieval',
    sources: extractSources(response),
  };
}
```

---

## Phase 4: Unified API Endpoint

**Explanation:** Create a single `/api/chat` endpoint that replaces the current fragmented endpoints for the new unified flow. It manages sessions, calls the orchestrator, dispatches to the correct agent, and streams responses back via SSE.

**Complexity:** Medium
**Value:** High - this is the integration point
**Frontend testable:** Yes (can build a minimal chat UI to test against this endpoint)

### Implementation Sketch

#### 4a. New endpoint in `server.mjs`

```js
// POST /api/chat
// Body: { sessionId?: string, message: string }
// Response: SSE stream

app.post('/api/chat', async (req, res) => {
  const { sessionId, message } = req.body;

  // Get or create session
  const session = getOrCreateSession(sessionId);

  // Route the message
  const routing = await routeMessage(message, session);

  // Add user message to conversation history
  session.conversationHistory.push({ role: 'user', content: message });

  initSSE(res);

  let responseContent;

  switch (routing.handler) {
    case 'coach':
      session.activeQuestionId = routing.questionId;
      responseContent = await coachResponse(routing.questionId, message, session);
      break;

    case 'retrieval':
      responseContent = await retrievalResponse(message, session);
      break;

    case 'suggest':
      responseContent = await suggestNextQuestions(session);
      break;

    case 'general':
      responseContent = await generalResponse(message, session);
      break;
  }

  // Stream response
  streamResponse(res, responseContent);

  // Add to conversation history
  session.conversationHistory.push({
    role: 'assistant',
    content: responseContent.message,
    metadata: { handler: routing.handler, questionId: routing.questionId }
  });

  // Background: check cross-resolution
  if (routing.handler === 'coach') {
    checkCrossResolutionInBackground(session);
  }
});
```

#### 4b. Session management endpoint

```js
// GET /api/chat/session/:id — returns session state (progress, active question, etc.)
// DELETE /api/chat/session/:id — clears session
```

#### 4c. Suggest-next logic

```js
async function suggestNextQuestions(session) {
  const unaddressed = Object.entries(session.questions)
    .filter(([_, q]) => q.status !== 'addressed')
    .map(([id, _]) => NESTA_QUESTIONS[id]);

  // Use LLM to pick 2-3 most relevant next questions based on
  // what's been discussed so far
  const suggestions = await pickNextQuestions(unaddressed, session.conversationHistory);

  return {
    message: `Great work! You've covered that well. Here are some related areas to think about:\n\n${formatSuggestions(suggestions)}\n\nWhich of these would you like to explore?`,
    type: 'suggest',
    suggestions,
  };
}
```

---

## Phase 5: Unified Chat Frontend

**Explanation:** Build the new chat-first UI that replaces the form-based `Coach.tsx` and `AssessmentDashboard.tsx` with a single, clean conversational interface — like ChatGPT or any modern AI chatbot. No sidebar, no dashboard, no visible framework scaffolding. The user just sees a chat. Progress is tracked internally by the backend session and surfaced naturally through the conversation (e.g., the coach says "great, you've covered goals — have you thought about...").

**Complexity:** Medium-High
**Value:** Critical - this is what the user sees
**Frontend testable:** Yes (full E2E testing)

### Implementation Sketch

#### 5a. New route and component structure

```
/coach → UnifiedChat.tsx (replaces Coach.tsx)
  - Full-screen chat interface (clean, minimal)
  - Input bar at bottom
  - Welcome message: "What public engagement issues can I help with today?"
  - No sidebar, no progress tracker, no visible question list
  - Progress is invisible to the user — managed by backend session state
```

#### 5b. `UnifiedChat.tsx` component

```tsx
function UnifiedChat() {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: WELCOME_MESSAGE, type: 'general' }
  ]);
  const [isStreaming, setIsStreaming] = useState(false);

  async function sendMessage(text: string) {
    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setIsStreaming(true);

    // Call /api/chat with SSE
    const response = await fetchChatSSE(sessionId, text);

    // Stream assistant response into messages
    setIsStreaming(false);
  }

  return (
    <div className="flex flex-col h-screen max-w-3xl mx-auto">
      <MessageList messages={messages} />
      <ChatInput onSend={sendMessage} disabled={isStreaming} />
    </div>
  );
}
```

#### 5c. Message rendering

Different message types get subtle visual treatments (but all feel like a natural chat):
- **Coach messages:** warm tone, may include a probing question
- **Retrieval messages:** include source citations rendered as small reference cards
- **Suggestion messages:** show 2-3 clickable question chips the user can pick
- **Resolution moments:** coach naturally says "great, you've covered X" — no banners or toasts

---

## Phase 6: Question Suggestion & Transition Flow

**Explanation:** Implement the post-resolution flow where the coach congratulates the user, summarizes what was addressed, and suggests 2-3 related unaddressed questions. Handle smooth transitions between questions.

**Complexity:** Low-Medium
**Value:** Medium-High - drives continued engagement
**Frontend testable:** Yes (E2E with the unified chat)

### Implementation Sketch

#### 6a. Suggestion prompt (`prompts/suggest-next.txt`)

```
You are helping a practitioner work through 9 public engagement questions.

COMPLETED: {{completedQuestions}}
REMAINING: {{remainingQuestions}}
CONVERSATION CONTEXT: {{recentConversation}}

Based on what they've discussed, suggest 2-3 remaining questions that:
1. Build naturally on what they've already covered
2. Are most critical for their specific project
3. Would benefit from being addressed next

For each suggestion, give a one-sentence reason why it's relevant now.

Return JSON: { "suggestions": [{ "questionId": N, "reason": "..." }] }
```

#### 6b. Transition message format

```
"You've done a great job articulating your project's goals! You've established that
you're aiming to [summary].

Have you thought about these related areas?

1. **Identifying participants** — Now that your goals are clear, it's a great time
   to think about who needs to be involved.
2. **Defining tasks** — With clear goals, you can start defining what participants
   will actually do.
3. **Establishing ownership** — Who will champion these goals and ensure follow-through?

Which would you like to explore, or is there something else on your mind?"
```

---

## Phase 7: Reflection & Export Integration

**Explanation:** Adapt the existing reflection generation and PDF export to work with the new session-based data. The reflection should pull from the coaching conversations stored in the session rather than the old form-based responses.

**Complexity:** Low-Medium
**Value:** Medium - preserves existing value
**Frontend testable:** Yes (generate reflection from session data)

### Implementation Sketch

#### 7a. New reflection endpoint

```js
// POST /api/chat/reflection
// Body: { sessionId: string }
// Uses session state to build reflection input

app.post('/api/chat/reflection', async (req, res) => {
  const session = getSession(req.body.sessionId);

  // Build responses from coaching conversations
  const responses = {};
  for (const [id, q] of Object.entries(session.questions)) {
    responses[id] = q.userResponse || summarizeFromHistory(q.coachingHistory);
  }

  // Reuse existing reflection generation with adapted input
  // ... existing generate-reflection logic
});
```

#### 7b. Progress-gated reflection

- Show "Generate Reflection" option when 7+ questions are addressed (same threshold as current)
- In the chat, the coach can suggest: "You've addressed 7 of 9 questions. Would you like to generate a reflection summary?"
- Reflection renders inline or opens a new panel

---

## Phase 8: Cleanup & Migration

**Explanation:** Remove or deprecate the old form-based flow. Update routing, navigation, and any shared state. Ensure backward compatibility for any saved sessions.

**Complexity:** Low
**Value:** Medium - reduces maintenance burden
**Frontend testable:** Yes (full regression)

### Implementation Sketch

- Remove or archive `Coach.tsx` (9-question form), `AssessmentDashboard.tsx`, `CoachingChatPanel.tsx`
- Keep `ChatBot.tsx` floating widget if still needed for general Q&A, or fold into unified chat
- Update `routes.ts` to point `/coach` at `UnifiedChat.tsx`
- Update `Home.tsx` CTA to point to unified chat
- Keep old API endpoints (`/api/evaluate-assessment`, etc.) temporarily for backward compatibility
- Remove scenario generation flow (no longer needed since coaching is conversational)

---

## Implementation Order & Dependencies

```
Phase 1 (Session + Orchestrator)
    ↓
Phase 2 (Coach Agent)  ←→  Phase 3 (Retrieval Agent)   [can parallelize]
    ↓                           ↓
Phase 4 (Unified API Endpoint)
    ↓
Phase 5 (Unified Chat Frontend)
    ↓
Phase 6 (Suggestion Flow)
    ↓
Phase 7 (Reflection Integration)
    ↓
Phase 8 (Cleanup)
```

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Session storage | In-memory Map (for now) | Simple; upgrade to Redis/DB when needed for persistence across restarts |
| Orchestrator approach | LLM-based classification | More flexible than rule-based; can handle ambiguous inputs |
| Coaching granularity | One question at a time | Keeps conversations focused; user can jump between questions |
| Agent communication | Orchestrator dispatches, agents return structured JSON | Clean separation; easy to test individually |
| Streaming | SSE (same as current) | Already works, no need to change transport |
| Old endpoints | Keep temporarily | Allows gradual migration; remove in Phase 8 |

## Risk & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Orchestrator misclassifies messages | User gets wrong agent response | Include confidence score; fall back to coach if ambiguous; tune prompt with examples |
| Coaching feels repetitive | User disengagement | Vary probe types (specificity, feasibility, completeness); track probe history |
| Session state lost on server restart | User loses progress | Phase 1 uses in-memory; add persistence layer if needed |
| LLM latency from orchestrator + agent (2 calls) | Slow responses | Can cache orchestrator decisions for follow-up messages in same question; optimize prompt length |
| Cross-resolution detection adds latency | Delays progress updates | Run in background (already the pattern); update session state async |
