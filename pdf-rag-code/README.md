# AI RAG: Case Intelligence System

A single-page web app that answers open-ended questions about a set of **client
transcripts** and **reference documents** using a real retrieval-augmented
generation (RAG) pipeline.

Users upload multiple PDFs (transcripts + policy/reference documents), which are
chunked, embedded, and stored in a vector database. Each question is answered
from only the most relevant chunks, and the **sources/evidence** used are shown.

## Architecture

```
                       ┌──────────────────────────────────────────────┐
                       │                  INGESTION                    │
                       │                                              │
  PDFs (multi-upload)  │  PDFLoader ─▶ TextSplitter ─▶ Embedder        │
  ───────────────────▶ │  (parse)      (chunk 800/150) (local MiniLM)  │
                       │       │  each chunk tagged with metadata     │
                       │       │  (source, docType, client, page)     │
                       │       ▼                                      │
                       │   Qdrant Vector Store (collection)           │
                       └──────────────────────────────────────────────┘
                                            ▲
                                            │ top-k semantic search (k=8)
                       ┌────────────────────┴───────────────────────────┐
                       │                   RETRIEVAL                     │
                       │  question ─▶ embed ─▶ Qdrant ─▶ top chunks      │
                       │   (source/type/client/page headers injected)   │
                       └────────────────────┬───────────────────────────┘
                                            ▼
                       ┌──────────────────────────────────────────────┐
                       │              GENERATION (Gemini)              │
                       │  Grounded answer + sources/evidence           │
                       └──────────────────────────────────────────────┘
```

**Components**

- **Server** (`server/`) — Express + LangChain.js
  - `index.js` — HTTP API: multi-file upload (`POST /upload/pdf`) and chat (`POST /chat`). Retrieves top-k chunks, builds a re-labelled context block, streams a Gemini answer, and returns the retrieved chunks (with full metadata) for evidence.
  - `worker.js` — BullMQ worker (needs Redis/Valkey). Consumes upload jobs, parses each PDF, chunks it, tags metadata, embeds, and inserts into Qdrant.
  - `embeddings.js` — shared local embedding provider (transformers.js + `Xenova/all-MiniLM-L6-v2`) and vector-store config.
  - `metadata.js` — infers `docType` (transcript/document) and `client` (robert/nathan) from the filename.
  - `ingest.js` — shared ingestion pipeline (parse → chunk → tag → embed → insert) with retry/backoff.
  - `ingest-dataset.js` — helper to bulk-ingest a folder of PDFs (used to preload the provided dataset).
- **Client** (`client/`) — Next.js 15 single-page UI: multi-PDF upload, question input, streamed answer, and a **Sources** list plus collapsible retrieved-chunk evidence.

**Pieces of the RAG pipeline**

1. **Ingestion** — PDFs are parsed with `PDFLoader`, split with
   `RecursiveCharacterTextSplitter` (chunk size 800, overlap 150). Each chunk is
   tagged with metadata: source filename, `docType` (transcript/document),
   `client` (robert/nathan), and page number.
2. **Embedding** — **fully local** via transformers.js (`Xenova/all-MiniLM-L6-v2`,
   384-dim). No API key, no quota, runs in-process. This avoids the Gemini
   embedding rate limits entirely.
3. **Storage/Retrieval** — vectors live in **Qdrant**. On chat, the question is
   embedded and the top 8 chunks are retrieved by semantic similarity
   (cross-transcript and transcript+document queries work because all sources
   share one collection and are labelled by metadata).
4. **Generation** — the question + retrieved chunks (each prefixed with
   `[source | type | client | page]`) are sent to **Gemini** (`gemini-2.5-flash`)
   for answer generation only. No hardcoding — everything is retrieved from the
   store.

## Dataset

Place your PDFs in folders and point the ingest script at them
(`transcriptions_for_test/`, `docs_for_test/`). By default the ingest script
looks for `transcript_w_docs/docs_for_test` and
`transcript_w_docs/transcriptions_for_test` next to the project folder.

## Setup

### 1. Prerequisites

- **Docker** (for Qdrant vector DB + Valkey/Redis queue)
- **Node.js** (v18+) and **bun** (or pnpm/npm)
- A **Google AI Studio** API key for Gemini (used only for answer generation).
  Embeddings are fully local via transformers.js — no key or quota needed.

### 2. Environment

```bash
cd server
cp .env.example .env
# edit .env and set GEMINI_API_KEY=your_key
```

### 3. Run infrastructure (Qdrant + Valkey/Redis)

```bash
cd server
docker compose up -d
```

### 4. Start the server and worker

```bash
cd server
bun install

# Terminal 1 — worker (ingests PDFs)
bun run start:worker

# Terminal 2 — API server
bun run start
```

> Note: the first time it embeds, transformers.js downloads the
> `Xenova/all-MiniLM-L6-v2` model into a local cache (~90 MB). This happens
> automatically and is free/unlimited.

### 5. (Optional) Preload the provided dataset

```bash
cd server
bun run ingest:dataset
```

### 6. Start the client

```bash
cd client
bun install
bun dev
```

Open **http://localhost:3000**. Upload the transcripts and documents (multi-select
allowed) or rely on the preloaded dataset, then ask questions.

## Quick start (everything in one go)

```bash
docker compose up -d          # qdrant + valkey
bun run start:worker &        # ingest worker
bun run ingest:dataset        # preload the test PDFs
bun run start &               # API on :8000
# separate terminal:
cd ../client && bun dev       # UI on :3000
```

## API

- `POST /upload/pdf` — multipart form, field `pdf`, multiple files allowed. Enqueues ingestion jobs.
- `POST /chat` — `{ "message": "..." }` → streams `[docs json]\n__DOCS_END__\n<answer text>`.
