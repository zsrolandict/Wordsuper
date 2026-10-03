import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLegalRefs, groupLegalRefs, legalRefIssues, romanToNumber } from './legalRefs';

const p = (...texts: string[]) => texts.map(text => ({ text }));

test('roman numbers for njt.hu addresses', () => {
  assert.deepEqual(['I', 'IV', 'V', 'IX', 'XC', 'CXXX', 'LXXVIII', 'CXLI'].map(romanToNumber), [1, 4, 5, 9, 90, 130, 78, 141]);
});

test('acts, code sections, decrees, court decisions and EU acts are found, each with a place to open it', () => {
  const refs = findLegalRefs(p(
    'A felekre a Polgári Törvénykönyvről szóló 2013. évi V. törvény (Ptk.) 6:98. § (2) bekezdése irányadó.',
    'A Ptk. 6:186. §-a szerinti kötbér, valamint az Inytv. rendelkezései.',
    'A 2007. évi CXXVII. tv. és a 335/2005. (XII. 29.) Korm. rendelet szerint.',
    'Lásd: BH 2019.123., EBH 2020. 45, Pfv.I.20.123/2020/5. és a 3/2019. (III. 7.) AB határozat, valamint a 2/2010. PJE határozat.',
    'Az adatkezelés a GDPR és az (EU) 2019/1937 irányelv szerint történik.',
    'A szerződés 5.2. pontja és a 2026. október 3. napja nem jogszabály.',
  ));
  assert.deepEqual(refs.map(r => [r.paragraph, r.kind, r.text]), [
    [0, 'act', '2013. évi V. törvény (Ptk.) 6:98. § (2) bekezdése'],
    [1, 'act', 'Ptk. 6:186. §'],
    [1, 'act', 'Inytv.'],
    [2, 'act', '2007. évi CXXVII. tv.'],
    [2, 'decree', '335/2005. (XII. 29.) Korm. rendelet'],
    [3, 'court', 'BH 2019.123.'],
    [3, 'court', 'EBH 2020. 45'],
    [3, 'court', 'Pfv.I.20.123/2020/5.'],
    [3, 'court', '3/2019. (III. 7.) AB határozat'],
    [3, 'court', '2/2010. PJE határozat'],
    [4, 'eu', 'GDPR'],
    [4, 'eu', '(EU) 2019/1937 irányelv'],
  ]);
  assert.equal(refs[0].group, '2013. évi V. törvény (Ptk.)');
  assert.equal(refs[0].url, 'https://njt.jog.gov.hu/jogszabaly/2013-5-00-00');
  assert.equal(refs[1].group, '2013. évi V. törvény (Ptk.)', 'the abbreviation goes with the act');
  assert.equal(refs[2].url, 'https://njt.jog.gov.hu/jogszabaly/1997-141-00-00');
  assert.equal(refs[3].url, 'https://njt.jog.gov.hu/jogszabaly/2007-127-00-00');
  assert.equal(refs[4].url, 'https://njt.jog.gov.hu/jogszabaly/2005-335-20-22', 'a government decree opens directly');
  assert.equal(refs[10].url, 'https://eur-lex.europa.eu/eli/reg/2016/679/oj');
  assert.equal(refs[11].url, 'https://eur-lex.europa.eu/eli/dir/2019/1937/oj');
  const groups = groupLegalRefs(refs);
  assert.equal(groups[0].refs.length, 2);
});

test('checks without a database: repealed acts, the old Ptk. numbering, a Ptk. book that does not exist', () => {
  const issues = legalRefIssues(findLegalRefs(p(
    'Az 1959. évi IV. törvény 318. §-a szerint, és a Gt. alapján.',
    'A Ptk. 318. §-a és a Ptk. 9:12. § szerint.',
    'A 2013. évi V. törvény 6:98. §-a rendben van, ahogy az 1959. évi IV. törvény is másodszor.',
  )));
  assert.equal(issues.length, 4, 'the repeated old act is said once');
  assert.match(issues[0].message, /^„1959\. évi IV\. törvény 318\. §”: a régi Ptk\. 2014\. március 15\. óta nem hatályos, helyette a 2013\. évi V\. törvény/);
  assert.match(issues[1].message, /^„Gt\.”: a régi Gt\. 2014\. március 15\. óta nem hatályos/);
  assert.match(issues[2].message, /^„Ptk\. 318\. §”: ez a régi Ptk\. számozása/);
  assert.match(issues[3].message, /^„Ptk\. 9:12\. §”: a Ptk\.-nak nincs 9\. könyve/);
  assert.deepEqual(issues.map(i => i.at.paragraph), [0, 0, 1, 1]);
  assert.ok(issues.every(i => i.kind === 'legal-ref'));
});

test('a ministerial decree is searched on the Nemzeti Jogszabálytár', () => {
  const [ref] = findLegalRefs([{ text: 'a 25/2014. (III. 5.) BM rendelet szerint' }]);
  assert.equal(ref.kind, 'decree');
  assert.match(ref.url, /google\.com\/search\?q=.*25%2F2014.*site%3Anjt\.jog\.gov\.hu/);
});

test('the example address: a government decree from 2008', () => {
  const [ref] = findLegalRefs([{ text: '176/2008. (VI. 30.) Korm. rendelet' }]);
  assert.equal(ref.url, 'https://njt.jog.gov.hu/jogszabaly/2008-176-20-22');
});
