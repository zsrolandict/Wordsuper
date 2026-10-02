import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Masker, leftoverPlaceholders, maskRequest, parseExtraTerms } from './masking';

const party = 'Eladó: Kovács János (szül.: Budapest, 1980. 05. 12., anyja neve: Nagy Mária), lakcím: 1111 Budapest, Fő utca 12/A., adóazonosító jel: 8123456789, e-mail: kovacs.janos@example.hu, telefon: +36 30 123 4567.';
const company = 'Vevő: az ABC Ingatlanfejlesztő Kft. (székhely: 2600 Vác, Széchenyi u. 3., cégjegyzékszám: Cg. 13-09-123456, adószám: 12345678-2-13, bankszámlaszám: 11700024-20012345-00000000), képviseli: dr. Szabó Anna ügyvezető.';

test('masks Hungarian personal and company identifiers', () => {
  const masker = new Masker();
  const masked = masker.mask(`${party}\n${company}`);
  for (const secret of ['Kovács János', '1980. 05. 12.', 'Fő utca 12/A', '8123456789', 'kovacs.janos@example.hu', '+36 30 123 4567',
    'ABC Ingatlanfejlesztő Kft.', 'Széchenyi u. 3.', '13-09-123456', '12345678-2-13', '11700024-20012345-00000000', 'Szabó Anna']) {
    assert.ok(!masked.includes(secret), `${secret} leaked: ${masked}`);
  }
  // Legal content stays readable
  assert.ok(masked.includes('Eladó:') && masked.includes('képviseli:') && masked.includes('ügyvezető'));
  assert.match(masked, /\[CÉG_1\]/);
});

test('the same value gets the same placeholder everywhere, and unmasking restores the text', () => {
  const masker = new Masker();
  const a = masker.mask('Vevő: ABC Kft. fizet.');
  const b = masker.mask('Az ABC Kft. a vételárat megfizeti.');
  assert.equal(a, 'Vevő: [CÉG_1] fizet.');
  assert.equal(b, 'Az [CÉG_1] a vételárat megfizeti.');
  assert.equal(masker.unmask('A [CÉG_1] köteles.'), 'A ABC Kft. köteles.');
  assert.equal(masker.unmask('Ismeretlen [CÉG_9] marad.'), 'Ismeretlen [CÉG_9] marad.');
});

test('names found in one field are hidden in later fields too', () => {
  const masker = new Masker();
  masker.mask('képviseli: Kiss Péter');
  assert.equal(masker.mask('Kiss Péter aláírja.'), '[SZEMÉLY_1] aláírja.');
});

test('the user\'s own terms are always hidden', () => {
  const masker = new Masker(parseExtraTerms('Napfény projekt\nZöld Liget'));
  const masked = masker.mask('A Napfény projekt a Zöld Liget mellett.');
  assert.match(masked, /^A \[EGYÉB_\d\] a \[EGYÉB_\d\] mellett\.$/);
  assert.equal(masker.unmask(masked), 'A Napfény projekt a Zöld Liget mellett.');
});

test('while streaming, a half-arrived placeholder is hidden until it completes', () => {
  const masker = new Masker();
  masker.mask('képviseli: Kiss Péter');
  assert.equal(masker.unmask('Aláírja: [SZEMÉ', true), 'Aláírja: ');
  assert.equal(masker.unmask('Aláírja: [SZEMÉLY_1]', true), 'Aláírja: Kiss Péter');
});

test('summary lists what the AI did not see', () => {
  const masker = new Masker();
  masker.mask('Vevő: ABC Kft., e-mail: a@b.hu, másik: c@d.hu');
  assert.equal(masker.summary(), '2 e-mail-cím, 1 cégnév');
  assert.equal(masker.count, 3);
});

test('ordinary contract text is left alone', () => {
  const masker = new Masker();
  const text = 'A Vételár 45 000 000 Ft, amelyet a Vevő 2026. december 31-ig fizet meg a 3.2. pont szerint.';
  assert.equal(masker.mask(text), text);
});

test('headers and all-caps words that merely start like a legal form are left alone', () => {
  const masker = new Masker();
  const text = '=== AROUND THE SELECTION (characters 1–10 of 20) ===\nA SELECTION AGREEMENT szerint az ABC Kft. fizet.';
  assert.equal(masker.mask(text), '=== AROUND THE SELECTION (characters 1–10 of 20) ===\nA SELECTION AGREEMENT szerint az [CÉG_1] fizet.');
});

test('placeholders the AI invented are reported', () => {
  const masker = new Masker();
  masker.mask('Vevő: ABC Kft.');
  assert.deepEqual(leftoverPlaceholders(masker.unmask('A [CÉG_1] és a [CÉG_2], valamint [CÉG_2] és [A_1].')), ['[CÉG_2]']);
});

test('values the user wants the AI to see are never hidden', () => {
  const masker = new Masker([], ['Nemzeti Adó- és Vámhivatal Kft.', 'ABC Kft.']);
  assert.equal(masker.mask('Az ABC Kft. és a XYZ Kft. szerződik.'), 'Az ABC Kft. és a [CÉG_1] szerződik.');
});

test('a party given by name gets the same placeholder as in the text', () => {
  const masker = new Masker();
  const sent = maskRequest({ mode: 'review', instruction: 'Kockázatok', originalText: '', documentContext: 'Az ABC Kft. eladja az ingatlant.', party: 'ABC Kft.' }, masker);
  assert.ok(!sent.party!.includes('ABC'));
  assert.ok(sent.documentContext.includes(sent.party!));
  assert.equal(maskRequest({ mode: 'edit', instruction: 'x', originalText: 'y', documentContext: '', party: 'Vevő' }, new Masker()).party, 'Vevő');
});
