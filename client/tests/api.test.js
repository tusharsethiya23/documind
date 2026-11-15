import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { askStream, parseSseMessage } from '../src/lib/api.js'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** Fake fetch returning an SSE body delivered in the given chunks. */
function mockStream(chunks, status = 200) {
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(new TextEncoder().encode(c))
          controller.close()
        },
      }),
      { status, headers: { 'Content-Type': 'text/event-stream' } },
    )
}

test('parses an SSE message', () => {
  assert.deepEqual(parseSseMessage('event: token\ndata: {"text":"Hi"}'), { event: 'token', data: { text: 'Hi' } })
  assert.equal(parseSseMessage(': keep-alive comment'), null)
})

test('streams sources, tokens and done, even when messages are split across chunks', async () => {
  mockStream([
    'event: sources\ndata: {"sources":[{"number":1}]}\n\nevent: tok',
    'en\ndata: {"text":"Hello "}\n\nevent: token\ndata: {"text":"world [1]"}\n',
    '\nevent: done\ndata: {"text":"Hello world [1]","citations":[1]}\n\n',
  ])
  const seen = { sources: null, text: '', done: null, error: null }
  await askStream(
    { question: 'q' },
    {
      onSources: (s) => (seen.sources = s),
      onToken: (t) => (seen.text += t),
      onDone: (d) => (seen.done = d),
      onError: (e) => (seen.error = e),
    },
  )
  assert.deepEqual(seen.sources, [{ number: 1 }])
  assert.equal(seen.text, 'Hello world [1]')
  assert.deepEqual(seen.done.citations, [1])
  assert.equal(seen.error, null)
})

test('handles CRLF line endings', async () => {
  mockStream(['event: done\r\ndata: {"text":"ok"}\r\n\r\n'])
  let done
  await askStream({ question: 'q' }, { onDone: (d) => (done = d) })
  assert.equal(done.text, 'ok')
})

test('reports server error events', async () => {
  mockStream(['event: error\ndata: {"message":"Rate limited"}\n\n'])
  let error
  await askStream({ question: 'q' }, { onError: (e) => (error = e) })
  assert.equal(error, 'Rate limited')
})

test('reports a stream that ends without a done event', async () => {
  mockStream(['event: token\ndata: {"text":"Half an ans"}\n\n'])
  let error
  await askStream({ question: 'q' }, { onError: (e) => (error = e) })
  assert.match(error, /closed before the answer finished/)
})

test('reports JSON errors from a rejected request', async () => {
  globalThis.fetch = async () => Response.json({ error: 'Ask a question.' }, { status: 400 })
  let error
  await askStream({ question: '' }, { onError: (e) => (error = e) })
  assert.equal(error, 'Ask a question.')
})
