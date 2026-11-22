/**
 * POST /api/ask  { question, documentIds?, provider?, topK?, mode? }
 *   mode "compare" (with 2-4 documentIds) searches each document separately
 *   and asks for a per-document answer plus a comparison.
 *
 * Streams the answer as Server-Sent Events:
 *   event: sources  { sources: [...], groups? }   retrieved passages, numbered from 1
 *                                                 (groups: per-document coverage when comparing)
 *   event: token    { text }                      answer text as it is generated
 *   event: done     { text, refused, citations, uncited, invalidCitations, reason? }
 *   event: error    { message }
 */
import { Router } from 'express';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { HttpError } from '../middleware/errors.js';
import { getLLM, LLMError } from '../services/llm.js';
import {
  bestScore,
  finalize,
  generate,
  generateComparison,
  isAnswerable,
  REFUSAL,
  retrieve,
  retrieveForComparison,
} from '../services/qa.js';

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
  score: hit.score == null ? null : Number(hit.score.toFixed(4)),
  matchedBy: hit.matchedBy,
  rerankScore: hit.rerankScore == null ? null : Number(hit.rerankScore.toFixed(3)),
});

function parseBody(body = {}) {
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) throw new HttpError(400, 'Ask a question.');
  if (question.length > 2000) throw new HttpError(400, 'The question is too long (2000 characters max).');

  const documentIds = Array.isArray(body.documentIds) ? body.documentIds : [];
  if (!documentIds.every((id) => mongoose.isValidObjectId(id))) throw new HttpError(400, 'Invalid document id.');

  const topK = body.topK === undefined ? config.topK : Number(body.topK);
  if (!Number.isInteger(topK) || topK < 1 || topK > 20) throw new HttpError(400, 'topK must be between 1 and 20.');

  const mode = body.mode ?? 'ask';
  if (!['ask', 'compare'].includes(mode)) throw new HttpError(400, 'mode must be "ask" or "compare".');
  const uniqueIds = [...new Set(documentIds)];
  if (mode === 'compare' && (uniqueIds.length < 2 || uniqueIds.length > 4)) {
    throw new HttpError(400, 'Pick 2 to 4 documents to compare.');
  }

  return { question, documentIds: mode === 'compare' ? uniqueIds : documentIds, topK, provider: body.provider, mode };
}

router.post('/', async (req, res) => {
  const { question, documentIds, topK, provider, mode } = parseBody(req.body);
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
    let hits;
    let groups = null;
    if (mode === 'compare') {
      ({ hits, groups } = await retrieveForComparison(question, documentIds));
      send('sources', {
        sources: hits.map(toSource),
        groups: groups.map(({ documentId, filename, covered }) => ({ documentId, filename, covered })),
      });
    } else {
      hits = await retrieve(question, { topK, documentIds });
      send('sources', { sources: hits.map(toSource) });
    }

    const answerable = groups ? groups.some((g) => g.covered) : isAnswerable(hits);
    if (!answerable) {
      send('done', {
        text: REFUSAL,
        refused: true,
        reason: 'low_relevance',
        bestScore: hits.length ? bestScore(hits) : null,
        citations: [],
        uncited: false,
        invalidCitations: [],
      });
      return res.end();
    }

    let text = '';
    const stream = groups
      ? generateComparison(question, groups, llm, { signal: controller.signal })
      : generate(question, hits, llm, { signal: controller.signal });
    for await (const part of stream) {
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
