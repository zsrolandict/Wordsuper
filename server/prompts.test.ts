import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseRequest, parseTranscribeRequest } from './prompts';
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

test('keeps the first and the latest history turns and drops invalid style values', () => {
  const history = Array.from({ length: 8 }, (_, i) => ({ instruction: `i${i}`, result: `r${i}` }));
  const parsed = parseRequest({ ...valid, history, styleProfile: { addressing: 'rude', tone: 'legal', notes: 'Megbízó' } });
  assert.ok('value' in parsed);
  assert.equal(parsed.value.history!.length, MAX_HISTORY_TURNS);
  // The first round holds the original intent, so it always stays
  assert.deepEqual(parsed.value.history!.map(t => t.instruction), ['i0', 'i4', 'i5', 'i6', 'i7']);
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
  assert.equal(edit.responseJsonSchema, undefined);
  const review = buildPrompt({ mode: 'review', instruction: 'Kockázatok', originalText: '', documentContext: 'doc' });
  assert.ok(review.responseJsonSchema);
  assert.ok(review.prompt.includes('DOCUMENT TO REVIEW:\ndoc'));
});

test('compare mode needs the change list and answers with JSON', () => {
  assert.ok('error' in parseRequest({ mode: 'compare', instruction: 'x', documentContext: '' }));
  const parsed = parseRequest({ mode: 'compare', instruction: 'Mi a kockázat?', documentContext: 'CHANGE 1 (added):\nAFTER: Kötbér.' });
  assert.ok('value' in parsed);
  const built = buildPrompt(parsed.value);
  assert.ok(built.responseJsonSchema);
  assert.ok(built.prompt.startsWith('CHANGES BETWEEN THE EARLIER AND THE CURRENT VERSION:\nCHANGE 1'));
});

test('masked requests tell the model to keep the placeholders', () => {
  const parsed = parseRequest({ ...valid, originalText: '[CÉG_1] fizet.', masked: true });
  assert.ok('value' in parsed && parsed.value.masked);
  assert.match(buildPrompt(parsed.value).systemInstruction, /Keep every placeholder exactly/);
  assert.doesNotMatch(buildPrompt({ ...parsed.value, masked: false }).systemInstruction, /PLACEHOLDERS/);
});

test('Word paragraph marks reach the model as line breaks', () => {
  const parsed = parseRequest({ ...valid, originalText: 'Első\rMásodik', documentContext: 'A\r\nB', history: [{ instruction: 'x', result: 'C\rD' }] });
  assert.ok('value' in parsed);
  assert.equal(parsed.value.originalText, 'Első\nMásodik');
  assert.equal(parsed.value.documentContext, 'A\nB');
  assert.equal(parsed.value.history![0].result, 'C\nD');
});

test('without a selection the whole document is edited or commented', () => {
  const edit = buildPrompt({ mode: 'edit', instruction: 'Aláírósor', originalText: 'Szerződés', documentContext: '', wholeDocument: true });
  assert.match(edit.systemInstruction, /WHOLE DOCUMENT/);
  const comment = buildPrompt({ mode: 'comment', instruction: 'Kockázatok', originalText: 'Szerződés', documentContext: '', wholeDocument: true });
  assert.ok(comment.prompt.includes('WHOLE DOCUMENT TO ANALYZE:\nSzerződés'));
  const parsed = parseRequest({ mode: 'edit', instruction: 'x', originalText: 'y', documentContext: '', wholeDocument: true });
  assert.ok('value' in parsed && parsed.value.wholeDocument === true);
});

test('review findings carry a fix', () => {
  const review = buildPrompt({ mode: 'review', instruction: 'Ellentmondások', originalText: '', documentContext: 'doc' });
  assert.match(review.systemInstruction, /"suggestion" is the fix/);
  assert.ok(JSON.stringify(review.responseJsonSchema).includes('"suggestion"'));
});

test('dictation uploads are validated', () => {
  assert.deepEqual(parseTranscribeRequest({ audio: 'AAAA', mimeType: 'audio/webm;codecs=opus' }), { value: { audio: 'AAAA', mimeType: 'audio/webm' } });
  assert.ok('error' in parseTranscribeRequest({ audio: 'AAAA', mimeType: 'video/webm' }));
  assert.ok('error' in parseTranscribeRequest({ audio: 'not base64!', mimeType: 'audio/ogg' }));
  assert.ok('error' in parseTranscribeRequest({ audio: 'A'.repeat(4_000_004), mimeType: 'audio/ogg' }));
});
