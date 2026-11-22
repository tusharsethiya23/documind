import assert from 'node:assert/strict'
import { test } from 'node:test'
import { citedNumbers, pageLabel, splitInline, toBlocks } from '../src/lib/answerFormat.js'

test('splits citations out of text', () => {
  assert.deepEqual(splitInline('Paris [1][2], since 508 [3, 4].'), [
    { type: 'text', text: 'Paris ' },
    { type: 'cite', n: 1 },
    { type: 'cite', n: 2 },
    { type: 'text', text: ', since 508 ' },
    { type: 'cite', n: 3 },
    { type: 'cite', n: 4 },
    { type: 'text', text: '.' },
  ])
})

test('handles bold text and ignores non-numeric brackets', () => {
  assert.deepEqual(splitInline('**Key:** see [a] [1]'), [
    { type: 'bold', text: 'Key:' },
    { type: 'text', text: ' see [a] ' },
    { type: 'cite', n: 1 },
  ])
})

test('builds paragraphs and bullet lists', () => {
  const blocks = toBlocks('Intro line\ncontinues [1].\n\n- First [2]\n- Second\n\n1. Step one\n2. Step two')
  assert.equal(blocks.length, 3)
  assert.equal(blocks[0].type, 'p')
  assert.equal(blocks[0].parts[0].text, 'Intro line continues ')
  assert.equal(blocks[1].type, 'list')
  assert.equal(blocks[1].ordered, false)
  assert.equal(blocks[1].items.length, 2)
  assert.equal(blocks[2].ordered, true)
})

test('a list directly after a sentence is still a list', () => {
  const blocks = toBlocks('The findings:\n- A [1]\n- B [2]')
  assert.deepEqual(blocks.map((b) => b.type), ['p', 'list'])
})

test('partial streaming text does not throw', () => {
  for (const partial of ['', 'Hel', 'Hello [', 'Hello [1', '- item **bo']) assert.doesNotThrow(() => toBlocks(partial))
})

test('lists cited numbers in order of first appearance', () => {
  assert.deepEqual(citedNumbers('B [2]. A [1][2]. C [3, 1].'), [2, 1, 3])
})

test('formats page labels', () => {
  assert.equal(pageLabel({ pageStart: 4, pageEnd: 4 }), 'p. 4')
  assert.equal(pageLabel({ pageStart: 4, pageEnd: 5 }), 'pp. 4–5')
})
