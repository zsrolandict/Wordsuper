import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Masker, maskRequest, parseExtraTerms, unresolvedPlaceholders } from './masking';

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
  assert.deepEqual(unresolvedPlaceholders(masker.unmask('A [CÉG_1] és a [CÉG_2], valamint [CÉG_2] és [A_1].')), ['[CÉG_2]']);
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

test('placeholders the AI mangled are still put back', () => {
  const masker = new Masker();
  masker.mask('Képviseli: Kovács János ügyvezető. Vevő: ABC Kft., adószám: 12345678-2-13.');
  const cases: [string, string][] = [
    ['[SZEMÉLY_1] aláírja', 'Kovács János aláírja'],
    ['[személy_1] aláírja', 'Kovács János aláírja'],
    ['[SZEMELY_1] aláírja', 'Kovács János aláírja'],
    ['[Személy 1] aláírja', 'Kovács János aláírja'],
    ['SZEMÉLY_1 aláírja', 'Kovács János aláírja'],
    ['[PERSON_1] signs for [COMPANY_1]', 'Kovács János signs for ABC Kft.'],
    ['{CÉG-1}, tax number: [TAX NUMBER 1]', 'ABC Kft., tax number: 12345678-2-13'],
    ['[ceg_01]-vel', 'ABC Kft.-vel'],
  ];
  for (const [answer, expected] of cases) {
    assert.equal(masker.unmask(answer), expected, answer);
    assert.deepEqual(unresolvedPlaceholders(masker.unmask(answer)), [], answer);
  }
});

test('any placeholder that cannot be resolved is caught, in any spelling', () => {
  const masker = new Masker();
  masker.mask('Képviseli: Kovács János ügyvezető.');
  const answer = masker.unmask('[SZEMÉLY_1], [személy_2], [CEG 1], {PERSON_7}, COMPANY_3 és [cím_1].');
  assert.deepEqual(unresolvedPlaceholders(answer), ['[személy_2]', '[CEG 1]', '{PERSON_7}', 'COMPANY_3', '[cím_1]']);
});

test('ordinary bracketed text and numbering are not placeholders', () => {
  const text = 'Lásd [1], [5.2.], [Melléklet 1], [Lot 2], (Eladó 1), a 2. pont és a szerzodes_v2 fájl. Cég 1 évig.';
  assert.deepEqual(unresolvedPlaceholders(text), []);
});

test('placeholder-like text of the document itself is never taken for ours', () => {
  const masker = new Masker();
  const sent = maskRequest({ mode: 'edit', instruction: 'Töltsd ki', originalText: 'Sablon: [CÉG_1] képviseli: Kovács János ügyvezető, az ABC Kft.', documentContext: '' }, masker);
  // Our own tokens skip the number the document already uses
  assert.ok(sent.originalText.startsWith('Sablon: [CÉG_1] képviseli: [SZEMÉLY_1]'));
  assert.ok(sent.originalText.includes('[CÉG_2]'));
  const answer = masker.unmask('[CÉG_1] és [CÉG_2]');
  assert.equal(answer, '[CÉG_1] és ABC Kft.');
  // The document's own text is not an unresolved placeholder; one the AI made up is
  assert.deepEqual(unresolvedPlaceholders(answer, ['Sablon: [CÉG_1] képviseli: Kovács János ügyvezető, az ABC Kft.']), []);
  assert.deepEqual(unresolvedPlaceholders('[CÉG_3]', ['Sablon: [CÉG_1]']), ['[CÉG_3]']);
});

test('while streaming, a half-arrived placeholder in any spelling is hidden', () => {
  const masker = new Masker();
  masker.mask('Vevő: ABC Kft.');
  assert.equal(masker.unmask('A szerződő fél: [cég 1', true), 'A szerződő fél: ');
  assert.equal(masker.unmask('A szerződő fél: [CÉG_', true), 'A szerződő fél: ');
  assert.equal(masker.unmask('A szerződő fél: [cég 1]', true), 'A szerződő fél: ABC Kft.');
});

const maskedBy = (text: string, masker = new Masker()) => masker.mask(text);

test('names without a telltale word: party block, signature block, foreign names', () => {
  assert.equal(maskedBy('Kiss Péter (születési hely, idő: Budapest, 1980.) mint Vevő'), '[SZEMÉLY_1] (születési hely, idő: Budapest, 1980.) mint Vevő');
  assert.equal(maskedBy('Jiří Dvořák (szül.: Prága) és Anna Novák'), '[SZEMÉLY_1] (szül.: Prága) és [SZEMÉLY_2]');
  // The line break stays: the role on the next line is not part of the name
  assert.equal(maskedBy('____________\nKovács János\nEladó'), '____________\n[SZEMÉLY_1]\nEladó');
  assert.equal(maskedBy('Jiří Dvořák ügyvezető'), '[SZEMÉLY_1] ügyvezető');
  assert.equal(maskedBy('This Agreement is signed by Peter Kiss and John Smith.'), 'This Agreement is signed by [SZEMÉLY_1] and [SZEMÉLY_2].');
});

test('names with known given names, inflected, married, titled, in capitals', () => {
  const masker = new Masker();
  const masked = masker.mask('A díjat Kovács Annának kell megfizetni, Nagy-Szabó Jánosné és ifj. Tóth Gábor jelenlétében. DR. NAGY ANNA ellenjegyzi.');
  assert.equal(masked, 'A díjat [SZEMÉLY_1]nak kell megfizetni, [SZEMÉLY_2] és [SZEMÉLY_3] jelenlétében. [SZEMÉLY_4] ellenjegyzi.');
  // Back exactly as it was, suffixes included
  assert.equal(masker.unmask(masked), 'A díjat Kovács Annának kell megfizetni, Nagy-Szabó Jánosné és ifj. Tóth Gábor jelenlétében. DR. NAGY ANNA ellenjegyzi.');
});

test('a found name is hidden in capitals and by its surname where that means the person', () => {
  const masker = new Masker();
  const text = 'Képviseli: Kovács János ügyvezető. Kovács úr kijelenti, hogy Kovácsné és dr. Kovács is tud róla.\nKOVÁCS JÁNOS';
  const masked = masker.mask(text);
  for (const secret of ['Kovács', 'KOVÁCS']) assert.ok(!masked.includes(secret), masked);
  assert.equal(masker.unmask(masked), text);
});

test('ordinary capitalized words, institutions and defined terms are not taken for names', () => {
  const text = 'A Vevő az Eladó részére fizet. Annak érdekében a Magyar Nemzeti Bank és a Polgári Törvénykönyv szerint a Felek megállapodnak; Budapest, Szent István körút.';
  assert.equal(maskedBy(text), text);
});

test('invisible characters do not hide a name or a number', () => {
  assert.equal(maskedBy('képviseli: Ko\u200bvács Já\u00adnos ügyvezető, e-mail: ko\u200bvacs@example.hu'), 'képviseli: [SZEMÉLY_1] ügyvezető, e-mail: [EMAIL_1]');
});

test('bank accounts, tax numbers and land registry numbers in every usual spelling', () => {
  const cases: [string, string][] = [
    ['bankszámlaszám: 11773016 11111018 00000000', 'bankszámlaszám: [SZÁMLA_1]'],
    ['számlaszám: 11773016-11111018', 'számlaszám: [SZÁMLA_1]'],
    ['IBAN: HU42 1177 3016 1111 1018 0000 0000', 'IBAN: [SZÁMLA_1]'],
    ['IBAN: DE89 3704 0044 0532 0130 00', 'IBAN: [SZÁMLA_1]'],
    ['adószám: 12345678 2 41', 'adószám: [ADÓSZÁM_1]'],
    ['közösségi adószám: HU12345678', 'közösségi adószám: [ADÓSZÁM_1]'],
    ['adóazonosító jel: 8 123 456 789', 'adóazonosító jel: [ADÓSZÁM_1]'],
    ['a 4521/12 helyrajzi számú ingatlan', 'a [HRSZ_1] helyrajzi számú ingatlan'],
    ['a 12345/6 hrsz-ú ingatlan', 'a [HRSZ_1] hrsz-ú ingatlan'],
    ['belterület 12345/6 hrsz. alatti', 'belterület [HRSZ_1] hrsz. alatti'],
    ['(hrsz.: 1234/5/A/12)', '(hrsz.: [HRSZ_1])'],
  ];
  for (const [text, expected] of cases) assert.equal(new Masker().mask(text), expected, text);
});

test('identifiers, dates of birth and addresses without a postal code', () => {
  const cases: [string, string][] = [
    ['személyi azonosító: 1 800101 1234', 'személyi azonosító: [AZONOSÍTÓ_1]'],
    ['útlevélszám: AB1234567', 'útlevélszám: [AZONOSÍTÓ_1]'],
    ['Passport No. AB 123456', 'Passport No. [AZONOSÍTÓ_1]'],
    ['születési hely, idő: Budapest, 1980. 01. 01.; anyja', 'születési hely, idő: Budapest, [SZÜLETÉS_1]; anyja'],
    ['born on 12 May 1980', 'born on [SZÜLETÉS_1]'],
    ['lakcím: Budapest XII. kerület, Fő u. 1. 2. em. 3.', 'lakcím: [CÍM_1]'],
    ['lakóhelye: Szeged, Kossuth tér 4., adóazonosító jel: 8123456789', 'lakóhelye: [CÍM_1], adóazonosító jel: [ADÓSZÁM_1]'],
  ];
  for (const [text, expected] of cases) assert.equal(new Masker().mask(text), expected, text);
});

test('amounts, legal references, dates and titles stay visible (the AI needs them)', () => {
  const text = 'A vételár 85 000 000 Ft, azaz nyolcvanötmillió forint, amelyet 2026. október 1-ig a Ptk. 6:215. §-a és a 2013. évi V. törvény szerint kell megfizetni. Késedelmi kamat: 12 345 678 Ft. A szerződés címe: Adásvételi szerződés. Lásd az 1.2. pontot.';
  assert.equal(new Masker().mask(text), text);
});
