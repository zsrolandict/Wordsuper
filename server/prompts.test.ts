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
  assert.match(edit.systemInstruction, />> first 5-10 words of the paragraph/, 'a reason per changed paragraph');
  assert.match(edit.systemInstruction, /keep every legal reference/);
  const selection = buildPrompt({ mode: 'edit', instruction: 'Hivatalosabban', originalText: 'A Ptk. 6:186. §-a szerint', documentContext: '' });
  assert.match(selection.systemInstruction, /keep every legal reference/);
  assert.match(selection.systemInstruction, /1-3 short sentences/);
  assert.doesNotMatch(selection.systemInstruction, />> first/);
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

test('plain-text modes may ask back; the thinking depth is validated', () => {
  for (const mode of ['edit', 'comment', 'generate'] as const) {
    assert.match(buildPrompt({ mode, instruction: 'x', originalText: 'y', documentContext: '' }).systemInstruction, /===CLARIFY===/);
  }
  assert.doesNotMatch(buildPrompt({ mode: 'review', instruction: 'x', originalText: '', documentContext: 'doc' }).systemInstruction, /===CLARIFY===/);
  const deep = parseRequest({ mode: 'edit', instruction: 'x', originalText: 'y', documentContext: '', depth: 'deep' });
  const odd = parseRequest({ mode: 'edit', instruction: 'x', originalText: 'y', documentContext: '', depth: 'ultra' });
  assert.ok('value' in deep && deep.value.depth === 'deep');
  assert.ok('value' in odd && odd.value.depth === undefined);
});

test('the represented party is one short line and sets the point of view', () => {
  const parsed = parseRequest({ ...valid, party: '  Vevő\n\n(zálogkötelezett) ' + 'x'.repeat(200) });
  assert.ok('value' in parsed);
  assert.equal(parsed.value.party!.length, 100);
  assert.match(parsed.value.party!, /^Vevő \(zálogkötelezett\) x/);
  const neutral = parseRequest(valid);
  assert.ok('value' in neutral && neutral.value.party === undefined);

  const review = buildPrompt({ mode: 'review', instruction: 'x', originalText: '', documentContext: 'doc', party: 'Vevő' }).systemInstruction;
  assert.match(review, /REPRESENTS THIS PARTY: Vevő/);
  assert.match(review, /Judge risks/);
  assert.match(buildPrompt({ mode: 'edit', instruction: 'x', originalText: 'y', documentContext: '', party: 'Vevő' }).systemInstruction, /protect its interests/);
  assert.doesNotMatch(buildPrompt({ mode: 'edit', instruction: 'x', originalText: 'y', documentContext: '' }).systemInstruction, /REPRESENTS/);
});

test('translate mode needs the items and answers with one translation per id', () => {
  assert.ok('error' in parseRequest({ mode: 'translate', instruction: 'Fordítsd', originalText: '', documentContext: '' }));
  const built = buildPrompt({ mode: 'translate', instruction: 'Fordítsd magyarról angolra', originalText: 'Vevő → Buyer', documentContext: '[[1]] A Vevő fizet.\n[[2]] Zárás.' });
  assert.match(built.systemInstruction, /every id exactly once/);
  assert.match(built.prompt, /GLOSSARY[\s\S]*Vevő → Buyer/);
  assert.match(built.prompt, /\[\[2\]\] Zárás\./);
  assert.ok(built.responseJsonSchema);
});

test('a review against a playbook: checked playbook, one check per rule, the rules in the prompt', () => {
  const playbook = { id: 'p', name: 'NDA', contractType: 'NDA', side: 'Megbízó', rules: [{ id: 'r1', topic: 'Titoktartás', standard: 'Öt év.', fallback1: 'Három év.', fallback2: '', walkAway: 'Egy év alatt.', clause: '' }] };
  const parsed = parseRequest({ mode: 'review', instruction: 'Ellenőrizd', documentContext: 'A titoktartás két évig tart.', playbook });
  assert.ok('value' in parsed);
  const built = buildPrompt(parsed.value);
  assert.match(built.prompt, /^PLAYBOOK: NDA[\s\S]*\[r1\] Titoktartás\n {2}Standard: Öt év\.[\s\S]*DOCUMENT TO CHECK:\nA titoktartás két évig tart\./);
  assert.match(built.systemInstruction, /every rule id exactly once/);
  assert.match(built.systemInstruction, /never mention it, its fallbacks or its walk-away in a suggestion/);
  const schema = built.responseJsonSchema as { properties: { checks: { items: { properties: { position: { enum: string[] } } } } } };
  assert.deepEqual(schema.properties.checks.items.properties.position.enum, ['standard', 'fallback1', 'fallback2', 'walkaway', 'missing']);
  // A broken playbook is refused, not quietly turned into a free review
  assert.deepEqual(parseRequest({ mode: 'review', instruction: 'x', documentContext: 'y', playbook: { name: 'Üres', rules: [] } }), { error: 'Invalid playbook' });
  // Only a review takes a playbook
  const edit = parseRequest({ mode: 'edit', instruction: 'x', originalText: 'y', playbook });
  assert.ok('value' in edit && !edit.value.playbook);
  // Without a playbook the review is the usual list of findings
  const plain = parseRequest({ mode: 'review', instruction: 'x', documentContext: 'y' });
  assert.ok('value' in plain && (buildPrompt(plain.value).responseJsonSchema as { type: string }).type === 'array');
});

test('a cover letter needs the list of changes and is plain text that adds nothing', () => {
  assert.deepEqual(parseRequest({ mode: 'letter', instruction: 'Írj levelet' }), { error: 'Missing originalText' });
  const parsed = parseRequest({ mode: 'letter', instruction: 'Írj levelet', originalText: '1. Foglaló: 10%-ra csökkentettük.' });
  assert.ok('value' in parsed);
  const built = buildPrompt(parsed.value);
  assert.equal(built.responseJsonSchema, undefined);
  assert.match(built.prompt, /^CHANGES WE MADE \(in the marked-up contract\):\n1\. Foglaló/);
  assert.match(built.systemInstruction, /never add new demands, concessions or facts/);
});
