import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseRequest } from './prompts';
import { MAX_CONTEXT_CHARS, MAX_HISTORY_TURNS, MAX_REVIEW_CHARS, MAX_SELECTION_CHARS } from '../src/shared/aiConfig';

const valid = { mode: 'edit', instruction: 'Javítsd', originalText: 'szöveg', documentContext: '' };

test('rejects unknown modes and missing fields', () => {
  assert.ok('error' in parseRequest({ ...valid, mode: 'hack' }));
  assert.ok('error' in parseRequest({ ...valid, instruction: '  ' }));
  assert.ok('error' in parseRequest({ ...valid, originalText: '' }));
  assert.ok('error' in parseRequest({ ...valid, mode: 'review', documentContext: '' }));
  assert.ok('value' in parseRequest({ ...valid, mode: 'generate', originalText: '' }));
});

test('truncates oversized fields per mode', () => {
  const big = 'x'.repeat(MAX_REVIEW_CHARS + 10);
  const edit = parseRequest({ ...valid, originalText: big, documentContext: big });
  const review = parseRequest({ ...valid, mode: 'review', documentContext: big });
  assert.ok('value' in edit && 'value' in review);
  assert.equal(edit.value.originalText.length, MAX_SELECTION_CHARS);
  assert.equal(edit.value.documentContext.length, MAX_CONTEXT_CHARS);
  assert.equal(review.value.documentContext.length, MAX_REVIEW_CHARS);
});

test('keeps only the last history turns and drops invalid style values', () => {
  const history = Array.from({ length: 8 }, (_, i) => ({ instruction: `i${i}`, result: `r${i}` }));
  const parsed = parseRequest({ ...valid, history, styleProfile: { addressing: 'rude', tone: 'legal', notes: 'Megbízó' } });
  assert.ok('value' in parsed);
  assert.equal(parsed.value.history!.length, MAX_HISTORY_TURNS);
  assert.equal(parsed.value.history![0].instruction, 'i3');
  assert.deepEqual(parsed.value.styleProfile, { addressing: '', tone: 'legal', notes: 'Megbízó' });
});

test('refinements show earlier rounds and ask for a complete new version', () => {
  const parsed = parseRequest({ ...valid, history: [{ instruction: 'Tedd hivatalosabbá', result: 'Első változat' }] });
  assert.ok('value' in parsed);
  const { prompt } = buildPrompt({ ...parsed.value, instruction: 'Legyen rövidebb' });
  assert.ok(prompt.includes('Your answer:\nElső változat'));
  assert.ok(prompt.includes('FOLLOW-UP INSTRUCTION'));
  assert.ok(prompt.trimEnd().endsWith('Legyen rövidebb'));
});

test('style preferences go into the system instruction; review asks for JSON', () => {
  const edit = buildPrompt({ mode: 'edit', instruction: 'x', originalText: 'y', documentContext: '', styleProfile: { addressing: 'formal', tone: '', notes: '' } });
  assert.ok(edit.systemInstruction.includes('magázás'));
  assert.equal(edit.responseSchema, undefined);
  const review = buildPrompt({ mode: 'review', instruction: 'Kockázatok', originalText: '', documentContext: 'doc' });
  assert.ok(review.responseSchema);
  assert.ok(review.prompt.includes('DOCUMENT TO REVIEW:\ndoc'));
});
