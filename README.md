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
| **Chat / coaching** | `POST /api/chatbot` | Runs OpenAI tool-calling against Weaviate and streams SSE responses back to the client |
| **Assessment / reflection** | `server.mjs` routes | Evaluates Nesta responses, generates scenarios, reflections, and case-study recommendations |
| **Main ingest path** | `scripts/ingest.py` | Reads `data/registry/**/*.json` or `Data Tracker.xlsx`, chunks documents, classifies content, enriches case studies, and writes to Weaviate |
| **Alternate PDF path** | `scripts/convert-pdfs.py` + `scripts/ingest-pdfs.mjs` | Converts PDFs to Markdown and indexes chunked content into `CoachingTool` |
| **Search** | Weaviate hybrid / nearText | Retrieval against `CoachingTool` and `CaseStudyLibrary` |

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

### Query the chatbot

```bash
curl -X POST http://localhost:3000/api/chatbot \
  -H "Content-Type: application/json" \
  -d '{"message": "What are the key findings?"}'
```

The response is a stream of Server-Sent Events (SSE):

```
data: {"content":"Based on the documents..."}

data: {"content":" the key findings are:"}

data: {"sourceDocuments":[{"title":"Report — Introduction","sourceFile":"report.pdf"}]}

data: [DONE]
```

---

## Project structure

```
coaching-tool-public-engagement/
├── data/registry/              # Curated + admin-created JSON source documents
├── documents/                  # PDFs and converted Markdown for the alternate PDF path
├── docs/
│   └── architecture-current-horizontal.svg
├── lib/
│   ├── weaviate-client.mjs     # Shared Weaviate + OpenAI client init
│   ├── agent-runner.mjs        # OpenAI tool-calling loop
│   ├── agent-tools.mjs         # Weaviate-backed tool definitions
│   ├── admin-routes.mjs        # Admin ingest and document APIs
│   ├── chunking.mjs            # Heading-aware Markdown chunking for PDF pipeline
│   └── schema.mjs              # Weaviate collection schema management
├── scripts/
│   ├── ingest.py               # Main registry / Excel ingestion pipeline
│   ├── ingest-pdfs.mjs         # Alternate PDF → Weaviate ingestion
│   ├── convert-pdfs.py         # Bulk PDF → Markdown conversion
│   └── convert-pdf-to-md.py    # Single PDF → Markdown conversion
├── src/                        # React application
├── prompts/                    # System prompts and scenario descriptions
├── server.mjs                  # Express server and API routes
├── .env.example                # Environment variable template
├── render.yaml                 # Render deployment config
├── package.json                # Dependencies & scripts
└── README.md
```
