# DocuMind

Ask questions about your PDFs (research papers, reports, company documents) and get answers that cite the exact page and passage they came from.

Built with the **MERN** stack: MongoDB Atlas (documents, chunks and vectors in one database), Express, React and Node.

> **Status: Week 1 of 4.** The ingestion and question-answering pipeline is done and usable from the command line. The REST API and the React UI come next. See the [Roadmap](#roadmap).

## How it works

```
PDF ─► pdfjs-dist ─► text blocks ─► section-aware ─► local embeddings ─► MongoDB Atlas
       (page + position   (headings,      chunks          (bge-small,          (vector + text
        of every block)    no headers/    (≤1200 chars,    transformers.js)     index)
                           footers)        never cross
                                           a heading)

Question ─┬─► $vectorSearch (meaning) ──┐
          │                             ├─► RRF merge ─► relevance gate ─► LLM (Claude / Ollama) ─► answer
          └─► $search BM25 (exact terms)┘   (top-k)      (too weak? say      forced to cite [n]      + sources
                                                          "I don't know")                            (file, page, quote)
```

- **Hybrid search.** Vector search finds passages with the same *meaning*. Keyword search (BM25) finds *exact terms*: names, codes, numbers and acronyms that embeddings blur. The two ranked lists are merged with Reciprocal Rank Fusion, so passages found by both rank highest. Set `SEARCH_MODE=vector` or `keyword` to compare.
- **Reranking.** A local cross-encoder (ms-marco MiniLM) reads the question and each of the top 20 passages together and reorders them by how well they answer it. Clearly irrelevant passages are dropped before the LLM sees them, because a small model tends to cite whatever is in its prompt. Set `RERANK=false` to compare.

- **Grounded answers.** The model sees numbered sources and must cite one for every claim. Citations are parsed and mapped back to a file, page range and passage. An answer with no citations, or with a citation to a source that doesn't exist, is flagged.
- **Says "I don't know".** If even the best match is weak, the LLM is never called. The model is also told to refuse when the sources don't contain the answer.
- **Highlight-ready.** Every chunk stores the page rectangles it came from, so the UI can highlight the exact passage in the PDF.
- **Free to index.** Embeddings run locally in Node, so indexing needs no API key.
- **Pluggable LLM.** Claude (`claude-opus-5-5`) by default, or a free local model through Ollama.

## Setup

Requirements: Node 20+ and a free MongoDB Atlas account.

### 1. MongoDB Atlas (free tier)

1. Sign up at <https://www.mongodb.com/cloud/atlas/register> and create a free **M0** cluster.
2. **Database Access**: add a database user with a password.
3. **Network Access**: add your IP address (or `0.0.0.0/0` while developing).
4. **Connect → Drivers**: copy the connection string.

### 2. Configure

```bash
cd server
npm install
cp .env.example .env     # Windows PowerShell: Copy-Item .env.example .env
```

Edit `server/.env`:
- `MONGODB_URI`: your Atlas connection string (with the password filled in)
- `ANTHROPIC_API_KEY`: from <https://console.anthropic.com>. Or set `LLM_PROVIDER=ollama` and install [Ollama](https://ollama.com) for a free local model.

### 3. Create the vector index (once)

```bash
npm run cli -- setup     # creates the vector and keyword indexes
npm run cli -- status    # wait until it says READY (queryable), about a minute
```

## Usage

```bash
npm run cli -- ingest ../papers/            # a folder or individual PDFs
npm run cli -- docs                         # list what's indexed
npm run cli -- search "attention mechanism" # retrieval only, no LLM, no API key
npm run cli -- ask "What dataset did they evaluate on?" --show-context
npm run cli -- chat                         # interactive
npm run cli -- ask "..." --doc <id>         # restrict to one document
npm run cli -- ask "..." --provider ollama
```

What an answer looks like (illustrative):

```
They evaluate on SQuAD v1.1 and Natural Questions [2], reporting 87.5% exact match [3].

Sources
  [2] paper.pdf, p. 6 · 4 Experiments
      "We evaluate on two open-domain QA benchmarks: SQuAD v1.1 and Natural Questions…"
  [3] paper.pdf, p. 7 · 5 Results
      "Our best model reaches 87.5% exact match on the held-out set…"
```

## Web app

Run the API and the React app in two terminals:

```bash
cd server && npm run dev     # API on http://localhost:5000
cd client && npm install && npm run dev     # app on http://localhost:5173
```

In development, Vite forwards `/api` requests to the API. To point a production build at a different API, set `VITE_API_URL` (for example `https://api.example.com/api`) before running `npm run build`.

## REST API

```bash
cd server
npm run dev        # http://localhost:5000, restarts on file changes
```

| Method | Route | What it does |
|---|---|---|
| `GET` | `/api/health` | Database and vector index status |
| `GET` | `/api/documents` | List documents |
| `POST` | `/api/documents` | Upload a PDF (multipart field `file`). Returns `202`; indexing continues in the background. |
| `GET` | `/api/documents/:id` | One document, including its `status` (`processing` → `ready` / `failed`) |
| `GET` | `/api/documents/:id/file` | The original PDF, for the viewer |
| `DELETE` | `/api/documents/:id` | Remove a document and its chunks |
| `POST` | `/api/ask` | `{ question, documentIds?, topK?, provider? }`. Streams the answer as Server-Sent Events. |

`/api/ask` sends these events:

| Event | Data |
|---|---|
| `sources` | The retrieved passages, numbered from 1, with file, pages, section, text and highlight regions |
| `token` | `{ text }`: the next piece of the answer |
| `done` | `{ text, refused, citations: [numbers], uncited, invalidCitations }` |
| `error` | `{ message }` |

If the browser disconnects, generation stops so you don't pay for tokens nobody reads.

Try it with curl:

```bash
curl -F "file=@paper.pdf" http://localhost:5000/api/documents
curl -N -X POST http://localhost:5000/api/ask -H "Content-Type: application/json" \
     -d '{"question": "What dataset did they use?"}'
```

## Tests

```bash
cd server && npm test
cd client && npm test
```

The tests cover PDF parsing (on a generated PDF), chunking, citation parsing, the refusal logic, prompt building, and the API's validation and error handling. They need no database or API key.

## Project structure

```
client/                     React app (Vite)
  src/
    App.jsx                 three-panel layout: documents, chat, PDF viewer
    components/             Header (API status), icons
    lib/api.js              API client, including the streaming answer parser
  tests/
server/
  src/
    server.js               starts the API
    app.js                  Express app
    routes/                 documents, ask (SSE), health
    middleware/errors.js    validation and JSON errors
    cli.js                  command-line interface
    config.js               settings from .env
    db.js                   MongoDB connection
    models/                 Document, Chunk (Mongoose)
    services/
      pdfParser.js          PDF → blocks (page, position, headings)
      chunker.js            blocks → section-aware chunks
      embeddings.js         local bge-small embeddings
      indexer.js            the full ingestion pipeline
      search.js             vector + keyword search, RRF merge, index setup
      reranker.js           cross-encoder reranking
      prompts.js            system prompt, numbered sources
      llm.js                Claude / Ollama streaming
      qa.js                 retrieve → gate → generate → citations
  tests/
```

## Roadmap

- [x] **Week 1: core pipeline.** PDF parsing with page positions, section-aware chunking, local embeddings, Atlas Vector Search, cited answers, "I don't know" gate, CLI, tests.
- [x] **Week 2: API and UI.** Express REST API (upload, documents, streaming answers over SSE) and a React (Vite) chat beside a PDF viewer that highlights the cited passage.
- [ ] **Week 3: quality.** ~~Hybrid search~~ ✓, ~~reranking~~ ✓, and an evaluation set with before/after metrics.
- [ ] **Week 4: ship.** Multi-document comparison, Docker, deployment, demo GIF.
