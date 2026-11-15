/**
 * POST /api/ask  { question, documentIds?, provider?, topK? }
 *
 * Streams the answer as Server-Sent Events:
 *   event: sources  { sources: [...] }            retrieved passages, numbered from 1
 *   event: token    { text }                      answer text as it is generated
 *   event: done     { text, refused, citations, uncited, invalidCitations, reason? }
 *   event: error    { message }
 */
import { Router } from 'express';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { HttpError } from '../middleware/errors.js';
import { getLLM, LLMError } from '../services/llm.js';
import { finalize, generate, isAnswerable, REFUSAL, retrieve } from '../services/qa.js';

const router = Router();

const toSource = (hit, i) => ({
  number: i + 1,
  chunkId: hit.chunkId,
  documentId: hit.documentId,
  filename: hit.filename,
  title: hit.title,
  section: hit.section,
  pageStart: hit.pageStart,
  pageEnd: hit.pageEnd,
  regions: hit.regions,
  text: hit.text,
  score: Number(hit.score.toFixed(4)),
});

function parseBody(body = {}) {
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) throw new HttpError(400, 'Ask a question.');
  if (question.length > 2000) throw new HttpError(400, 'The question is too long (2000 characters max).');

  const documentIds = Array.isArray(body.documentIds) ? body.documentIds : [];
  if (!documentIds.every((id) => mongoose.isValidObjectId(id))) throw new HttpError(400, 'Invalid document id.');

  const topK = body.topK === undefined ? config.topK : Number(body.topK);
  if (!Number.isInteger(topK) || topK < 1 || topK > 20) throw new HttpError(400, 'topK must be between 1 and 20.');

  return { question, documentIds, topK, provider: body.provider };
}

router.post('/', async (req, res) => {
  const { question, documentIds, topK, provider } = parseBody(req.body);
  let llm;
  try {
    llm = getLLM(provider);
  } catch (err) {
    throw new HttpError(400, err.message);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering (nginx, Render)
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Stop generating (and paying for tokens) if the browser goes away.
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const hits = await retrieve(question, { topK, documentIds });
    send('sources', { sources: hits.map(toSource) });

    if (!isAnswerable(hits)) {
      send('done', {
        text: REFUSAL,
        refused: true,
        reason: 'low_relevance',
        bestScore: hits[0]?.score ?? null,
        citations: [],
        uncited: false,
        invalidCitations: [],
      });
      return res.end();
    }

    let text = '';
    for await (const part of generate(question, hits, llm, { signal: controller.signal })) {
      if (controller.signal.aborted) break;
      text += part;
      send('token', { text: part });
    }
    if (controller.signal.aborted) return;

    const answer = finalize(question, text, hits);
    send('done', {
      text: answer.text,
      refused: answer.refused,
      citations: answer.citations.map((c) => c.number),
      uncited: answer.uncited,
      invalidCitations: answer.invalidCitations,
    });
    res.end();
  } catch (err) {
    if (controller.signal.aborted) return;
    if (!(err instanceof LLMError)) console.error(err);
    send('error', { message: err instanceof LLMError ? err.message : 'Something went wrong while answering.' });
    res.end();
  }
});

export default router;
