import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffForDisplay, diffTokens, planParagraphEdits, tokenizeLikeWord, type DiffHunk } from './textDiff';

// Applies hunks to the old tokens, the same way the Word layer does (from the last hunk to the first)
function apply(oldTokens: string[], hunks: DiffHunk[]) {
  const result = [...oldTokens];
  for (const h of [...hunks].reverse()) result.splice(h.oldStart, h.oldEnd - h.oldStart, ...h.newTokens);
  return result;
}

test('identical token lists have no hunks', () => {
  assert.deepEqual(diffTokens(['a', 'b'], ['a', 'b']), []);
});

test('a corrected word becomes a single replace hunk', () => {
  const oldT = 'A megbizott köteles a munkát elvégezni.'.split(' ');
  const newT = 'A megbízott köteles a munkát elvégezni.'.split(' ');
  assert.deepEqual(diffTokens(oldT, newT), [{ oldStart: 1, oldEnd: 2, newTokens: ['megbízott'] }]);
});

test('insertions, deletions and replacements all round-trip', () => {
  const cases: [string, string][] = [
    ['a b c d e', 'a x c e f'],
    ['a b c', ''],
    ['', 'x y'],
    ['one two three four five six', 'zero one three four seven six eight'],
    ['the cat sat on the mat', 'the dog sat on a mat today'],
  ];
  for (const [o, n] of cases) {
    const oldT = o.split(' ').filter(Boolean);
    const newT = n.split(' ').filter(Boolean);
    assert.deepEqual(apply(oldT, diffTokens(oldT, newT)), newT, `${o} -> ${n}`);
  }
});

test('hunks are ordered and do not overlap', () => {
  const hunks = diffTokens('a b c d e f g'.split(' '), 'a X c d Y f g Z'.split(' '));
  for (let i = 1; i < hunks.length; i++) assert.ok(hunks[i].oldStart >= hunks[i - 1].oldEnd);
});

test('tokenizeLikeWord trims spacing like getTextRanges([" "], true)', () => {
  assert.deepEqual(tokenizeLikeWord('\tElső  szó\r'), ['Első', 'szó']);
});

test('planParagraphEdits pairs non-empty paragraphs and skips unchanged ones', () => {
  const oldParagraphs = [['Első', 'bekezdes.'], [], ['Második', 'bekezdés.']];
  const plan = planParagraphEdits(oldParagraphs, 'Első bekezdés.\n\nMásodik bekezdés.');
  assert.deepEqual(plan, [{ paragraphIndex: 0, hunks: [{ oldStart: 1, oldEnd: 2, newTokens: ['bekezdés.'] }] }]);
});

test('planParagraphEdits gives up when the paragraph count changes', () => {
  assert.equal(planParagraphEdits([['a'], ['b']], 'a b'), null);
});

test('diffForDisplay marks removed and added words and keeps line breaks', () => {
  assert.deepEqual(diffForDisplay('a b\rc', 'a x\nc'), [
    { type: 'equal', tokens: ['a'] },
    { type: 'removed', tokens: ['b'] },
    { type: 'added', tokens: ['x'] },
    { type: 'equal', tokens: ['\n', 'c'] },
  ]);
});
