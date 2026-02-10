# Coaching Tool – Public Engagement

A RAG (Retrieval-Augmented Generation) chatbot pipeline that ingests local PDF documents into Weaviate and answers questions about them using OpenAI.

Adapted from the [Rebooting Democracy](https://github.com/CitizensFoundation/rebootdemocracy) codebase.

---

## Architecture

```
documents/*.pdf
       │
       ▼
┌──────────────┐    ┌────────────┐    ┌──────────┐
│ ingest-pdfs  │───▶│  Weaviate  │◀───│ chatbot  │
│  (CLI script)│    │ (vectors)  │    │ (Netlify │
└──────────────┘    └────────────┘    │  function)│
                                      └─────┬────┘
                                            │ OpenAI
                                            ▼
                                      LLM response
```

### Pipeline summary

| Step | Component | Description |
|------|-----------|-------------|
| **Ingest** | `scripts/ingest-pdfs.mjs` | Reads PDFs from `documents/`, extracts text, uses LLM to intelligently split into chapters, stores in Weaviate |
| **Search** | BM25 → nearText fallback | Keyword search first; if no hits, falls back to semantic vector search |
| **Chat** | `netlify/functions/chatbot.mjs` | Receives user question, retrieves context from Weaviate, streams an OpenAI response |

### Chunking strategy

The ingestion uses an **LLM-based intelligent chunking** approach (adapted from `DocumentTreeSplitAgent`):

1. The full document (with line numbers) is sent to GPT-4.1 to devise a chapter-based splitting strategy
2. A second LLM call reviews and validates the strategy (PASSES / FAILS)
3. If the review fails, the strategy is regenerated with the feedback (up to 5 retries)
4. Chapters exceeding 50 lines are recursively sub-chunked
5. Aggregated chunk data is validated against the original to ensure nothing was lost
6. Falls back to simple word-boundary chunking if the LLM approach fails

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

# 4. Run the ingestion pipeline
npm run ingest

# 5. Start the local dev server (Netlify CLI)
npx netlify dev
```

The chatbot UI will be at `http://localhost:8888/` and the API endpoint at `http://localhost:8888/.netlify/functions/chatbot`.

---

## Usage

### Ingest PDFs

```bash
# LLM-based intelligent chunking (default)
npm run ingest

# Fast word-boundary chunking (no LLM calls, cheaper)
npm run ingest -- --simple

# Wipe the Weaviate collection and re-ingest from scratch
npm run ingest -- --clear
```

### Query the chatbot

```bash
curl -X POST http://localhost:8888/.netlify/functions/chatbot \
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
├── documents/                  # Place your PDFs here
├── lib/
│   ├── weaviate-client.mjs     # Shared Weaviate + OpenAI client init
│   ├── chunking.mjs            # LLM-based chunking + simple fallback
│   └── schema.mjs              # Weaviate collection schema management
├── scripts/
│   └── ingest-pdfs.mjs         # CLI: PDF → Weaviate ingestion
├── netlify/
│   └── functions/
│       └── chatbot.mjs         # Netlify function: RAG chatbot endpoint
├── public/
│   └── index.html              # Chat UI (standalone HTML/CSS/JS)
├── .env.example                # Environment variable template
├── netlify.toml                # Netlify configuration
├── package.json                # Dependencies & scripts
└── README.md
```
