import { test } from 'node:test';
import assert from 'node:assert/strict';
import { footerXml, guessParties, headerXml, hungarianDate, ooxmlPackage, signatureBlockXml, tableOfContentsXml, TOC_INSTRUCTION } from './documentElements';

/** Every element opened is closed, in order */
function balanced(xml: string): boolean {
  const stack: string[] = [];
  for (const tag of xml.matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = tag;
    if (selfClosing) continue;
    if (closing) {
      if (stack.pop() !== name) return false;
    } else {
      stack.push(name);
    }
  }
  return stack.length === 0;
}

const options = {
  width: 9072, font: 'Cambria', accent: '#0B3B60', header: true, firm: 'ICT Europa Legal', title: 'Adásvételi szerződés',
  pageNumbers: true, confidential: true, documentId: 'ICT-2026/014', version: 'v3', date: '2026. október 3.',
};

test('header and footer: well formed, page X / Y as fields, the parts in order', () => {
  const header = headerXml(options);
  const footer = footerXml(options);
  assert.ok(balanced(header) && balanced(footer));
  assert.match(header, /<w:smallCaps\/>.*ICT Europa Legal.*<w:tab\/>.*Adásvételi szerződés/);
  assert.match(footer, /BIZALMAS.* · ICT-2026\/014.* · v3.* · 2026\. október 3\./);
  assert.match(footer, /Oldal .*<w:instrText xml:space="preserve"> PAGE <\/w:instrText>.* \/ .*<w:instrText xml:space="preserve"> NUMPAGES <\/w:instrText>/);
  assert.doesNotMatch(footerXml({ ...options, confidential: false, pageNumbers: false }), /BIZALMAS|PAGE/);
  assert.ok(balanced(ooxmlPackage(header)));
});

test('signature block: two borderless columns with the place, date, line, name and role', () => {
  const xml = signatureBlockXml({ place: 'Budapest', date: '', left: { role: 'Eladó', name: 'ABC Kft.' }, right: { role: 'Vevő', name: '' }, representative: true, font: 'Cambria' });
  assert.ok(balanced(xml));
  assert.equal((xml.match(/<w:tc>/g) ?? []).length, 2);
  assert.match(xml, /w:val="nil"/);
  assert.match(xml, /Budapest, ……/);
  assert.match(xml, /ABC Kft\..*Eladó.*képviseli/);
  assert.match(xml, /Vevő/);
});

test('table of contents lists the heading styles and our chapter style; parties and dates', () => {
  const xml = tableOfContentsXml('Cambria', '#0B3B60');
  assert.ok(balanced(xml));
  assert.ok(xml.includes(TOC_INSTRUCTION.replace(/"/g, '&quot;')));
  assert.deepEqual(guessParties(['Ingatlan', 'Bérlő', 'Bérbeadó']), ['Bérlő', 'Bérbeadó']);
  assert.deepEqual(guessParties(['Vevő']), ['Vevő', 'Eladó']);
  assert.deepEqual(guessParties([]), ['Eladó', 'Vevő']);
  assert.equal(hungarianDate(new Date(2026, 9, 3)), '2026. október 3.');
});

test('signature row for the footer: smaller, little room, no place and date line', () => {
  const o = { place: 'Budapest', date: '2026. október 3.', left: { role: 'Eladó', name: '' }, right: { role: 'Vevő', name: '' }, representative: false, font: 'Cambria' };
  const full = signatureBlockXml(o);
  const compact = signatureBlockXml({ ...o, compact: true });
  assert.match(full, /Budapest, 2026\. október 3\./);
  assert.doesNotMatch(compact, /Budapest/);
  assert.match(full, /w:before="1200"/);
  assert.match(compact, /w:before="360"/);
  assert.match(compact, /<w:sz w:val="16"\/>/);
  assert.match(compact, /Eladó[\s\S]*Vevő/);
});
