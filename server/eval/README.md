# Evaluation

Measures how well DocuMind finds the right passage and answers from it. Latest numbers: [RESULTS.md](RESULTS.md).

## Reproduce

1. Download the two papers into `papers/` at the repository root (it is gitignored):

   ```bash
   curl -L -o papers/attention-vaswani-2017.pdf https://arxiv.org/pdf/1706.03762v7
   curl -L -o papers/rag-lewis-2020.pdf https://arxiv.org/pdf/2005.11401v4
   ```

2. Index them and run the evaluation:

   ```bash
   cd server
   npm run cli -- ingest ../papers
   npm run eval                    # retrieval + answers (uses the LLM in .env)
   npm run eval -- --retrieval-only  # retrieval only, no LLM, about a minute
   ```

`npm run eval` rewrites `RESULTS.md` and `results.json`.

## Files

- `questions.json`: 23 questions with answers in the papers and 5 without. Each answerable question has an `evidence` phrase copied from the paper (used to judge retrieval) and the expected answer facts (used to judge answers).
- `run.js`: runs each search setup and answer setup, then writes the report.
- `RESULTS.md` / `results.json`: the latest report and per-question outputs.

## Adding questions

Copy the evidence phrase exactly from the paper. Check that it was indexed by running `npm run cli -- search "<phrase>" -m keyword`. Keep each phrase short (a few words), so it doesn't straddle a chunk boundary.
