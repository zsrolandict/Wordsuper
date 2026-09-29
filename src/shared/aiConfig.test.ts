import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClarification } from './aiConfig';

test('a clarifying answer is recognized and its options read', () => {
  const answer = '===CLARIFY===\n{"question": "Mire gondoltál?", "options": ["Egységesítsd a fogalmakat", "Cseréld a „kontraktor” szót „vállalkozó”-ra", ""]}';
  assert.deepEqual(parseClarification(answer), {
    question: 'Mire gondoltál?',
    options: ['Egységesítsd a fogalmakat', 'Cseréld a „kontraktor” szót „vállalkozó”-ra'],
  });
});

test('normal answers and broken clarifications are not questions', () => {
  assert.equal(parseClarification('A Vevő fizet.'), null);
  assert.equal(parseClarification('===CLARIFY===\nnem json'), null);
  assert.equal(parseClarification('===CLARIFY===\n{"question": "Mi?", "options": []}'), null);
});
