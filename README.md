# Coaching Tool – Public Engagement

A RAG (Retrieval-Augmented Generation) chatbot pipeline that ingests local PDF documents into Weaviate and answers questions about them using OpenAI.

Adapted from the [Rebooting Democracy](https://github.com/CitizensFoundation/rebootdemocracy) codebase.

---

## Architecture

Current runtime: `React + Vite` frontend, `Express` API server, `Weaviate`, and `OpenAI`, deployed as a Render web service. The older Netlify / serverless sketch is no longer accurate for this repo.

![Current architecture](docs/architecture-current-horizontal.svg)

### Pipeline summary

| Step | Component | Description |
|------|-----------|-------------|
| **Serve app** | `server.mjs` + `dist/` | Serves the React SPA and exposes the `/api/*` endpoints |
| **Unified coaching chat** | `POST /api/chat` | Orchestrator-routed SSE endpoint. Every user message is classified by `lib/orchestrator.mjs` into one of five actions (`coach-agent-open`, `coach-agent-continue`, `retrieval-agent`, `suggest-next`, `general`) and dispatched to the matching prompt-backed agent |
| **Reflection** | `POST /api/chat/reflection` | Generates an evidence-grounded end-of-session reflection from the unified chat session state, grounded in knowledge-base hits pre-fetched per Nesta question |
| **Admin classify** | `POST /api/admin/classify` | Document classifier used by the admin ingest pipeline (returns `{content_type, summary}`) |
| **Main ingest path** | `scripts/ingest.py` | Reads `data/registry/**/*.json` or `Data Tracker.xlsx`, chunks documents, classifies content, enriches case studies, and writes to Weaviate |
| **Alternate PDF path** | `scripts/convert-pdfs.py` + `scripts/ingest-pdfs.mjs` | Converts PDFs to Markdown and indexes chunked content into `CoachingTool` |
| **Search** | Weaviate hybrid / nearText | Retrieval against `CoachingTool` and `CaseStudyLibrary` |

### Prompts and routing

The conversational runtime is driven by a one-to-one mapping between orchestrator actions and prompt files in `prompts/`:

| Orchestrator action | Prompt file | Handler |
|---|---|---|
| `coach-agent-open` | `prompts/coach-agent-open.txt` | `lib/coach-agent.mjs` (opens a coaching conversation on a new Nesta question) |
| `coach-agent-continue` | `prompts/coach-agent-continue.txt` | `lib/coach-agent.mjs` (continues an active coaching conversation) |
| `retrieval-agent` | `prompts/retrieval-agent.txt` | `lib/retrieval-agent.mjs` (knowledge-base lookup for examples / stuck users) |
| `suggest-next` | `prompts/suggest-next.txt` | `lib/suggest-next.mjs` (recommends the next 2-3 Nesta questions after one resolves) |
| `general` | `prompts/general.txt` | `server.mjs` `handleGeneralMessage` (greetings, goodbyes, meta-questions, small talk) |

The `prompts/orchestrator.txt` file itself drives the routing classification, and `prompts/classify-document.txt` is used by the admin ingest pipeline. The coach and retrieval agents use a numbered inline-citation format (`¹²³`) followed by a `**Sources:**` list of markdown hyperlinks; `general.txt` and `suggest-next.txt` intentionally do not cite sources.

### Chunking and enrichment

The repo currently has two chunking paths:

1. `scripts/ingest.py` for the main registry / Excel pipeline
   - Uses Markdown-heading chunking when headings are present
   - Falls back to sliding-window chunking for unstructured text
   - Uses OpenAI for content classification and case-study metadata generation
2. `scripts/ingest-pdfs.mjs` + `lib/chunking.mjs` for the alternate PDF pipeline
   - Uses heading-aware Markdown section parsing
   - Sub-splits oversized sections with overlap
   - Adds contextual retrieval prefixes before indexing
   - Falls back to simple character-boundary chunking when needed

---

## Prerequisites

- **Node.js** >= 20
- **Weaviate** instance (cloud or local Docker)
- **OpenAI API key**

### Weaviate options

**Option A – Weaviate Cloud (recommended for getting started)**

1. Create a free sandbox at [console.weaviate.cloud](https://console.weaviate.cloud/)
2. Copy the cluster URL and API key

**Option B – Local Docker**

```bash
docker run -d \
  --name weaviate \
  -p 8080:8080 \
  -e AUTHENTICATION_ANONYMOUS_ACCESS_ENABLED=true \
  -e DEFAULT_VECTORIZER_MODULE=text2vec-openai \
  -e ENABLE_MODULES=text2vec-openai \
  -e CLUSTER_HOSTNAME=node1 \
  cr.weaviate.io/semitechnologies/weaviate:1.28.4
```

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your .env from the template
cp .env.example .env
# Then edit .env with your Weaviate and OpenAI credentials

# 3. Place your PDF files in the documents/ folder
cp /path/to/your/files/*.pdf documents/

# 4. Run the main ingestion pipeline
python scripts/ingest.py --source registry

# 5. Start the local dev stack
npm run dev
```

The Vite app runs at `http://localhost:3001/` and proxies `/api/*` requests to the Express server at `http://localhost:3000/`.

---

## Usage

### Ingest PDFs

```bash
# Main registry / Excel pipeline
python scripts/ingest.py --source registry

# Single-file registry ingest
python scripts/ingest.py --source registry --registry-file data/registry/<path>.json

# Wipe both Weaviate collections and rebuild
python scripts/ingest.py --clear

# Alternate PDF-only path
npm run convert
npm run ingest
```

### Query the unified coaching chat

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "demo-1", "message": "I want to work on defining my project goals"}'
```

`sessionId` is optional — the server will mint an `auto-<timestamp>` session if you omit it — but passing your own id lets you resume a conversation across requests. The response is a stream of Server-Sent Events (SSE):

```
data: {"content":"Welcome — let's work through your project goals..."}

data: {"metadata":{"sessionId":"demo-1","handler":"coach","questionId":1,"resolved":false,"suggestions":null,"sources":[{"title":"Nesta Participation Handbook","sourceUrl":"https://..."}],"sessionSummary":{"activeQuestionId":1,"addressedCount":0,"inProgressCount":1,"totalQuestions":9,"questions":[...]}}}

data: [DONE]
```

The `metadata` chunk tells the client which handler fired (`coach` / `retrieval` / `suggest` / `general`), whether the active Nesta question was marked resolved, any auto-suggested next questions, the source documents the agent retrieved, and a summary of the full session state.

To generate a reflection from a session once the user has addressed a few questions:

```bash
curl -X POST http://localhost:3000/api/chat/reflection \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "demo-1"}'
```

---

## Project structure

```
coaching-tool-public-engagement/
├── data/registry/                   # Curated + admin-created JSON source documents
├── documents/                       # PDFs and converted Markdown for the alternate PDF path
├── docs/
│   └── architecture-current-horizontal.svg
├── lib/
│   ├── weaviate-client.mjs          # Shared Weaviate + OpenAI client init
│   ├── agent-runner.mjs             # OpenAI tool-calling loop
│   ├── agent-tools.mjs              # Weaviate-backed tool definitions
│   ├── orchestrator.mjs             # Classifies each /api/chat message into a routing action
│   ├── coach-agent.mjs              # Runs the coach agent for open/continue turns
│   ├── retrieval-agent.mjs          # Knowledge-base lookup agent
│   ├── suggest-next.mjs             # Suggests the next Nesta questions to work on
│   ├── session-state.mjs            # In-memory per-session conversation state
│   ├── nesta-questions.mjs          # The 9 Nesta framework questions
│   ├── admin-routes.mjs             # Admin ingest, classify, and document APIs
│   ├── chunking.mjs                 # Heading-aware Markdown chunking for PDF pipeline
│   └── schema.mjs                   # Weaviate collection schema management
├── prompts/
│   ├── orchestrator.txt             # Routing classifier
│   ├── coach-agent-open.txt         # Opening turn of a coaching conversation
│   ├── coach-agent-continue.txt     # Mid-conversation coaching turn
│   ├── retrieval-agent.txt          # Knowledge-base retrieval
│   ├── suggest-next.txt             # Next-question suggestions
│   ├── general.txt                  # Greetings, off-topic, meta-questions
│   ├── generate-reflection.txt      # End-of-session reflection
│   ├── classify-document.txt        # Admin ingest document classifier
│   └── load.mjs                     # Loads all prompt files into exported constants
├── scripts/
│   ├── ingest.py                    # Main registry / Excel ingestion pipeline
│   ├── ingest-pdfs.mjs              # Alternate PDF → Weaviate ingestion
│   ├── convert-pdfs.py              # Bulk PDF → Markdown conversion
│   └── convert-pdf-to-md.py         # Single PDF → Markdown conversion
├── src/                             # React application (Vite + React Router)
├── lambda/                          # AWS Lambda handlers (admin + classify; legacy LLM handlers stubbed with 410)
├── layer/nodejs/                    # Shared Lambda layer (lib/ + prompts/classify-document.txt)
├── cdk/                             # AWS CDK stack for deployed infra
├── server.mjs                       # Express server and /api/* routes
├── .env.example                     # Environment variable template
├── render.yaml                      # Render deployment config
├── package.json                     # Dependencies & scripts
└── README.md
```
