import type { AIRequestBody } from '../shared/aiConfig';
import { GIVEN_NAMES } from './givenNames';
import { KNOWN_ROLES } from './parties';
import { stripControlChars } from './textDiff';

/**
 * Reversible masking of sensitive data before text leaves the machine: names, companies, e-mail addresses,
 * phone numbers, bank accounts, tax and registry numbers, addresses, land registry numbers. The AI only sees
 * placeholders like [CÉG_1]; the answer is unmasked here. The same value always gets the same placeholder,
 * so refinements and the document context stay consistent. Rule-based (no model), tuned for Hungarian documents.
 */

export type EntityKind =
  | 'CÉG' | 'SZEMÉLY' | 'EMAIL' | 'TELEFON' | 'SZÁMLA' | 'ADÓSZÁM' | 'CÉGJEGYZÉK' | 'CÍM' | 'HRSZ' | 'AZONOSÍTÓ' | 'SZÜLETÉS' | 'EGYÉB';

export const ENTITY_LABELS: Record<EntityKind, string> = {
  CÉG: 'cégnév',
  SZEMÉLY: 'személynév',
  EMAIL: 'e-mail-cím',
  TELEFON: 'telefonszám',
  SZÁMLA: 'bankszámlaszám',
  ADÓSZÁM: 'adószám / adóazonosító',
  CÉGJEGYZÉK: 'cégjegyzékszám',
  CÍM: 'cím',
  HRSZ: 'helyrajzi szám',
  AZONOSÍTÓ: 'személyes azonosító',
  SZÜLETÉS: 'születési adat',
  EGYÉB: 'saját kifejezés',
};

const U = 'A-ZÁÉÍÓÖŐÚÜŰ';
/** "Kft" → "[Kk][Ff][Tt]": legal forms are written in capitals too ("KFT.") */
const anyCase = (word: string) => [...word].map(c => (c.toLowerCase() === c.toUpperCase() ? c.replace(/[.]/g, '\\.') : `[${c.toLowerCase()}${c.toUpperCase()}]`)).join('');
/**
 * Legal forms: the abbreviations in any case (but the short English ones only as written: "se" or "ag" are words),
 * and the spelled-out Hungarian forms.
 */
const LEGAL_FORMS = [
  ...['Kft', 'Zrt', 'Nyrt', 'Bt', 'Kkt', 'Kht', 'Rt', 'Ltd', 'GmbH', 'Plc', 'e.v', 'ev'].map(anyCase),
  'Inc', 'LLC', 'AG', 'SE', 'KG',
  ...['Korlátolt Felelősségű Társaság', 'Zártkörűen Működő Részvénytársaság', 'Nyilvánosan Működő Részvénytársaság', 'Részvénytársaság',
    'Betéti Társaság', 'Közkereseti Társaság', 'Szövetkezet', 'Egyesülés', 'Alapítvány', 'Egyesület', 'Közhasznú Társaság',
    'egyéni vállalkozó'].map(form => form.split(' ').map(anyCase).join('[ \\u00a0]{1,2}')),
].join('|');
/** A word of a company name: capitalized or a number, possibly in quotes („Napfény”), with &, - or . inside */
const COMPANY_WORD = `[„"“»]?[${U}0-9][\\p{L}0-9&.\\-]*[”"“«]?`;
/** "eladó" → "[eE]ladó": a word at the start of a sentence or a line is capitalized too */
const eitherCase = (words: readonly string[]) => words.map(word => `[${word[0].toLowerCase()}${word[0].toUpperCase()}]${word.slice(1)}`).join('|');
const PERSON_KEYWORDS = eitherCase(['név', 'neve', 'nevű', 'képviseli', 'képviselő', 'képviseletében', 'ügyvezető', 'aláíró', 'meghatalmazott', 'tulajdonos', 'eladó', 'vevő', 'bérlő', 'bérbeadó', 'megbízó', 'megbízott']);

/** Capitalized words that are never part of a person's name: articles, parties, frequent defined terms */
const NOT_NAME = ['A', 'Az', 'Egy', 'És', 'Mint', 'Alulírott', 'The', 'An', 'And', 'Budapest', 'Magyarország', 'Felek', 'Fél',
  'Szerződés', 'Ingatlan', 'Vételár', 'Melléklet', 'Társaság', 'Ptk', 'Szent', ...KNOWN_ROLES];
const notName = (words: string[]) => `(?!(?:${words.join('|')})(?![\\p{L}-]))`;
/** Spaces inside a name; never a line break, so a name never runs into the next line ("Kovács János⏎Eladó") */
const SP = '[^\\S\\n]+';
/** One word of a person's name, in any alphabet: Kovács, Nagy-Szabó, Dvořák */
const NAME_WORD = `${notName(NOT_NAME)}\\p{Lu}\\p{Ll}+(?:-\\p{Lu}\\p{Ll}+)?`;
const NAME_WORD_UPPER = `${notName(NOT_NAME.map(w => w.toUpperCase()))}\\p{Lu}{2,}(?:-\\p{Lu}{2,})?`;
/** dr., ifj., id., özv., prof. in front of a name belong to it */
const TITLE = `(?:(?:[dD][rR]|[iI][fF][jJ]|[iI][dD]|[öÖ][zZ][vV]|[pP][rR][oO][fF])\\.${SP})*`;
/**
 * Given names, longest first; a final a/e may lengthen before a suffix (Anna → Annának), and the suffix stays
 * outside the masked value, so the AI can still inflect the placeholder: "[SZEMÉLY_1]nak".
 */
const givenNames = (upper: boolean) => [...GIVEN_NAMES]
  .sort((a, b) => b.length - a.length)
  .map(name => (upper ? name.toUpperCase() : name).replace(/a$/, upper ? '[AÁ]' : '[aá]').replace(/e$/, upper ? '[EÉ]' : '[eé]'))
  .join('|');
const GIVEN = `(?:${givenNames(false)})(?:né)?`;
const GIVEN_UPPER = `(?:${givenNames(true)})(?:NÉ)?`;
/** What follows the name of a party in its block: "Kiss Péter (szül.: …", "Jiří Dvořák, lakcím: …" */
const PERSONAL_DATA = eitherCase(['szül', 'anyja', 'lakcím', 'lakóhely', 'állampolgár', 'személyi', 'adóazonosító', 'útlevél', 'date of birth', 'born', 'residing', 'passport', 'nationality']);
/** What follows a name in a signature block or a party list: "Kovács János⏎Eladó", "Jiří Dvořák ügyvezető" */
const ROLE_AFTER = `${eitherCase([...KNOWN_ROLES, 'ügyvezető', 'vezérigazgató', 'igazgató', 'cégvezető', 'képviselő', 'meghatalmazott', 'tanú', 'ügyvéd', 'közjegyző', 'aláíró'])}|s\\.\\s?k\\.`;

interface Rule {
  kind: EntityKind;
  pattern: RegExp;
  /** Capture group holding the value to mask; the whole match when omitted */
  group?: number;
  /** A further check of the value the pattern can't express (e.g. the number of digits) */
  accept?: (value: string) => boolean;
}

const digitCount = (value: string) => value.replace(/\D/g, '').length;
/** Street, square, road… : what makes "Budapest XII. kerület, Fő u. 1." an address */
const STREET = 'utca|út|útja|tér|tere|körút|krt\\.|u\\.|köz|sor|sétány|fasor|park|dűlő|lakótelep|lépcső|rakpart|liget|street|road|avenue|square|Straße|Strasse|Platz';

// Order matters: specific identifiers first, so e.g. a tax number is not taken for a phone number
const RULES: Rule[] = [
  { kind: 'EMAIL', pattern: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  // Bank accounts: IBAN of any country ("HU42 1177 …", "DE89 3704 0044 0532 0130 00"), and the Hungarian
  // 2×8 or 3×8 digits with hyphens or spaces ("11773016-11111018", "11773016 11111018 00000000")
  {
    kind: 'SZÁMLA',
    pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g,
    accept: value => { const compact = value.replace(/ /g, ''); return compact.length >= 15 && compact.length <= 34 && digitCount(compact) >= 10; },
  },
  { kind: 'SZÁMLA', pattern: /(?<![\d-])\d{8}[- ]\d{8}(?:[- ]\d{8})?(?![\d-])/g },
  // Tax numbers: "12345678-2-41" or with spaces, EU VAT "HU12345678", tax ID (adóazonosító jel) "8123456789" or "8 123 456 789"
  { kind: 'ADÓSZÁM', pattern: /(?<![\d-])\d{8}[- ]\d[- ]\d{2}(?![\d-])/g },
  { kind: 'ADÓSZÁM', pattern: /\bHU\d{8}\b/g },
  { kind: 'ADÓSZÁM', pattern: /(?<!\d)8\d{9}(?!\d)/g },
  { kind: 'ADÓSZÁM', pattern: /\badóazonosító(?:\s+jel)?\s*:?\s*(8[\d ]{9,13}\d)/giu, group: 1, accept: value => digitCount(value) === 10 },
  { kind: 'CÉGJEGYZÉK', pattern: /(?:Cg\.\s*)?\b\d{2}-\d{2}-\d{6}\b/g },
  { kind: 'TELEFON', pattern: /(?:\+36|\b06)[\s\-/]?\(?\d{1,2}\)?[\s\-/]?\d{3}[\s-]?\d{3,4}\b/g },
  { kind: 'AZONOSÍTÓ', pattern: /\bTAJ(?:\s*szám)?\s*:?\s*(\d{3}\s?\d{3}\s?\d{3})\b/gu, group: 1 },
  { kind: 'AZONOSÍTÓ', pattern: /\b\d{6}[A-Z]{2}\b/g },
  // Personal identification number ("személyi azonosító: 1 800101 1234") and passport number, after their name
  { kind: 'AZONOSÍTÓ', pattern: /(?<!\p{L})személyi\s+(?:azonosító|szám)(?:\s+jel)?\s*:?\s*([1-8][ -]?\d{6}[ -]?\d{4})(?!\d)/giu, group: 1 },
  { kind: 'AZONOSÍTÓ', pattern: /(?<!\p{L})(?:útlevél\p{L}*(?:\s+szám\p{L}*)?|passport(?:\s+no\.?|\s+number)?)\s*:?\s*([A-Z]{2}\s?\d{6,7})\b/giu, group: 1 },
  // The date of birth: "szül.: 1980. 05. 12.", "születési hely, idő: Budapest, 1980. 01. 01.", "born on 12 May 1980"
  { kind: 'SZÜLETÉS', pattern: /\bszül(?:\.|etett|etési)[^\d;)\n]{0,40}?(\d{4}\.\s*(?:\d{1,2}|[a-zá-ű]+)\.?\s*\d{1,2}\.?)/giu, group: 1 },
  { kind: 'SZÜLETÉS', pattern: /\b(?:date\s+of\s+birth|born(?:\s+on)?)\s*:?\s*(\d{1,2}[./ ]\s?(?:\d{1,2}|\p{L}+)[./ ]\s?\d{4}|\d{4}[-./]\d{1,2}[-./]\d{1,2})/giu, group: 1 },
  // Land registry numbers, before or after the word: "hrsz. 12345/6", "4521/12 helyrajzi számú", "12345/6 hrsz-ú"
  { kind: 'HRSZ', pattern: /\b(?:hrsz\.?|helyrajzi\s+sz(?:ámú|ámon|ám)?\.?)\s*:?\s*(\d+(?:\/\d+)*(?:\/[A-Z]\/\d+)?)/giu, group: 1 },
  { kind: 'HRSZ', pattern: /(?<![\d/.])(\d+(?:\/\d+)*(?:\/[A-Z]\/\d+)?)\s*(?=(?:hrsz|helyrajzi\s+sz)\p{L}*)/giu, group: 1 },
  // 1111 Budapest, Fő utca 1. / 2600 Vác, Széchenyi u. 12/A
  {
    kind: 'CÍM',
    pattern: new RegExp(`\\b\\d{4}\\s+[${U}][\\p{L}-]+,?\\s+[^,;()\\n]{1,60}?\\s(?:${STREET})\\s*\\d+(?:[/-]?[A-Za-z0-9]+)*\\.?`, 'gu'),
  },
  // Without a postal code, after its name: "lakcím: Budapest XII. kerület, Fő u. 1. 2. em. 3." – up to the next field
  {
    kind: 'CÍM',
    pattern: new RegExp(`(?<![\\p{L}])(?:lakcím\\p{L}*|lakóhely\\p{L}*|székhely\\p{L}*|telephely\\p{L}*|tartózkodási\\s+hely\\p{L}*|levelezési\\s+cím\\p{L}*|címe?|address|residing\\s+at)\\s*:?\\s*([^;()\\n:]{3,120}?)(?=\\s*(?:;|\\)|\\n|$|,\\s*[\\p{L} .]{2,40}?:))`, 'giu'),
    group: 1,
    accept: value => new RegExp(`(?:^|\\s)(?:${STREET})(?:\\s|$)`, 'iu').test(value) && /\d/.test(value),
  },
  // Companies: capitalized words before a legal form (the article in front is not part of the name)
  {
    kind: 'CÉG',
    // Words of a name are one or two spaces apart: a wider gap (a two-column signature block) ends the name
    pattern: new RegExp(`(?<![\\p{L}\\d„"“»])(?!(?:A|Az|The)\\s)((?:${COMPANY_WORD}[ \\u00a0]{1,2}){0,7}${COMPANY_WORD}[ \\u00a0]{1,2}(?:${LEGAL_FORMS})(?![\\p{L}\\d])\\.?)`, 'gu'),
    group: 1,
  },
  // The legal form glued to the name, a frequent typo: "ABCKft.", "NapfényZrt"
  {
    kind: 'CÉG',
    pattern: new RegExp(`(?<![\\p{L}\\d])([${U}0-9][\\p{L}0-9&\\-]*[\\p{L}0-9](?:Kft|KFT|Zrt|ZRT|Nyrt|NYRT|Kkt|KKT)(?![\\p{L}\\d])\\.?)`, 'gu'),
    group: 1,
  },
  // People. Case-sensitive on purpose: only capitalized words count as a name ("… Anna ügyvezető" keeps "ügyvezető").
  // After a telltale word: "képviseli: dr. Kiss Anna", "név: Nagy Péter", "ügyvezető Kovács János"
  {
    kind: 'SZEMÉLY',
    pattern: new RegExp(`(?<![\\p{L}])(?:${PERSON_KEYWORDS})\\s*:?\\s+(${TITLE}${NAME_WORD}(?:${SP}${NAME_WORD}){1,2})`, 'gu'),
    group: 1,
  },
  // A party block: the name, then personal data ("Kiss Péter (születési hely, idő: …", "Jiří Dvořák, szül.: …")
  {
    kind: 'SZEMÉLY',
    pattern: new RegExp(`(?<![\\p{L}])(${TITLE}${NAME_WORD}(?:${SP}${NAME_WORD}){1,3})(?=\\s*[(,]\\s*[^()\\n]{0,40}?(?:${PERSONAL_DATA}))`, 'gu'),
    group: 1,
  },
  // A signature block or a list of signatories: the name, then the role ("Kovács János⏎Eladó", "… mint Vevő")
  {
    kind: 'SZEMÉLY',
    pattern: new RegExp(`(?<![\\p{L}])(${TITLE}${NAME_WORD}(?:${SP}${NAME_WORD}){1,2})(?=[^\\S\\n]*,?\\s*(?:mint${SP})?(?:${ROLE_AFTER})(?![\\p{L}]))`, 'gu'),
    group: 1,
  },
  // A known given name, Hungarian order: "Kovács János", "Nagy-Szabó Anna Mária", "Kovács Jánosné", "Kovács Annának"
  {
    kind: 'SZEMÉLY',
    pattern: new RegExp(`(?<![\\p{L}])(${TITLE}${NAME_WORD}(?:${SP}${NAME_WORD})?${SP}${GIVEN}(?:${SP}${GIVEN})?)`, 'gu'),
    group: 1,
  },
  // … and the other way round, as in English or German contracts: "Peter Kiss", "John Smith"
  {
    kind: 'SZEMÉLY',
    pattern: new RegExp(`(?<![\\p{L}])(${TITLE}${GIVEN}(?:${SP}${GIVEN})?${SP}${NAME_WORD})(?![\\p{L}])`, 'gu'),
    group: 1,
  },
  // In capitals, as in signature blocks: "KOVÁCS JÁNOS", "DR. NAGY ANNA", "PETER KISS"
  {
    kind: 'SZEMÉLY',
    pattern: new RegExp(`(?<![\\p{L}])(${TITLE}${NAME_WORD_UPPER}(?:${SP}${NAME_WORD_UPPER})?${SP}${GIVEN_UPPER}|${TITLE}${GIVEN_UPPER}${SP}${NAME_WORD_UPPER})(?![\\p{L}])`, 'gu'),
    group: 1,
  },
];

/** A company name without its legal form, when it is distinctive enough on its own: at least two words */
function companyCore(name: string): string | null {
  const core = name.replace(new RegExp(`[ \\u00a0]+(?:${LEGAL_FORMS})\\.?$`, 'u'), '').replace(/^[„"“»]|[”"“«]$/g, '').trim();
  return core !== name && core.split(/\s+/).length >= 2 && core.length >= 6 ? core : null;
}

/** The surname of a masked name: the first word ("Kovács János"), or the last one after a given name ("Peter Kiss") */
function surnameOf(name: string): string | null {
  const words = name.split(/\s+/).filter(word => !word.endsWith('.'));
  if (words.length < 2) return null;
  const surname = (GIVEN_NAMES as readonly string[]).includes(words[0]) ? words[words.length - 1] : words[0];
  return surname.length >= 3 ? surname : null;
}

/** A surname on its own is only a person with a form of address or as a married name: "Kovács úr", "Kovácsné", "dr. Kovács" */
const surnameUse = (surname: string) =>
  new RegExp(`(?<![\\p{L}])${surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=né|${SP}(?:úr|asszony|úrhölgy|kisasszony)\\p{Ll}*(?![\\p{L}]))|(?<=(?:[dD]r|[iI]fj|[iI]d|[öÖ]zv)\\.${SP})${surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!${SP}\\p{Lu})(?![\\p{L}])`, 'gu');

/**
 * How the AI writes a placeholder's kind when it does not copy it exactly: in lower case, without accents,
 * translated to English. Keys are normalized (see normalizeKind). Words that also occur in ordinary bracketed text
 * ("[Lot 1]", "[Term 2]") are left out on purpose.
 */
const KIND_ALIASES: Record<string, EntityKind> = {
  CEG: 'CÉG', CEGNEV: 'CÉG', TARSASAG: 'CÉG', VALLALAT: 'CÉG', COMPANY: 'CÉG', COMPANYNAME: 'CÉG', ORGANIZATION: 'CÉG', ORGANISATION: 'CÉG', ORG: 'CÉG', FIRM: 'CÉG', CORPORATION: 'CÉG', ENTITY: 'CÉG',
  SZEMELY: 'SZEMÉLY', SZEMELYNEV: 'SZEMÉLY', NEV: 'SZEMÉLY', PERSON: 'SZEMÉLY', PERSONNAME: 'SZEMÉLY', NAME: 'SZEMÉLY', INDIVIDUAL: 'SZEMÉLY',
  EMAIL: 'EMAIL', EMAILCIM: 'EMAIL', EMAILADDRESS: 'EMAIL',
  TELEFON: 'TELEFON', TELEFONSZAM: 'TELEFON', PHONE: 'TELEFON', PHONENUMBER: 'TELEFON', TELEPHONE: 'TELEFON',
  SZAMLA: 'SZÁMLA', SZAMLASZAM: 'SZÁMLA', BANKSZAMLA: 'SZÁMLA', BANKSZAMLASZAM: 'SZÁMLA', ACCOUNT: 'SZÁMLA', ACCOUNTNUMBER: 'SZÁMLA', BANKACCOUNT: 'SZÁMLA', IBAN: 'SZÁMLA',
  ADOSZAM: 'ADÓSZÁM', ADOAZONOSITO: 'ADÓSZÁM', ADOAZONOSITOJEL: 'ADÓSZÁM', TAXNUMBER: 'ADÓSZÁM', TAXID: 'ADÓSZÁM', VATNUMBER: 'ADÓSZÁM',
  CEGJEGYZEK: 'CÉGJEGYZÉK', CEGJEGYZEKSZAM: 'CÉGJEGYZÉK', REGISTRATIONNUMBER: 'CÉGJEGYZÉK', COMPANYREGISTRATION: 'CÉGJEGYZÉK', COMPANYREGISTRATIONNUMBER: 'CÉGJEGYZÉK', REGISTRYNUMBER: 'CÉGJEGYZÉK',
  CIM: 'CÍM', LAKCIM: 'CÍM', SZEKHELY: 'CÍM', ADDRESS: 'CÍM',
  HRSZ: 'HRSZ', HELYRAJZISZAM: 'HRSZ', PARCEL: 'HRSZ', PARCELNUMBER: 'HRSZ', CADASTRALNUMBER: 'HRSZ', LANDREGISTRYNUMBER: 'HRSZ',
  AZONOSITO: 'AZONOSÍTÓ', SZEMELYIAZONOSITO: 'AZONOSÍTÓ', ID: 'AZONOSÍTÓ', IDNUMBER: 'AZONOSÍTÓ', IDENTIFIER: 'AZONOSÍTÓ',
  SZULETES: 'SZÜLETÉS', SZULETESIDATUM: 'SZÜLETÉS', SZULETESIIDO: 'SZÜLETÉS', BIRTH: 'SZÜLETÉS', BIRTHDATE: 'SZÜLETÉS', DATEOFBIRTH: 'SZÜLETÉS', DOB: 'SZÜLETÉS',
  EGYEB: 'EGYÉB', SAJAT: 'EGYÉB', OTHER: 'EGYÉB', CUSTOM: 'EGYÉB',
};

/** "Személy", "SZEMELY", "bank account" → "SZEMELY", "BANKACCOUNT" */
const normalizeKind = (kind: string) => kind.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z]/g, '');

/**
 * Anything that looks like a placeholder, however mangled: "[CÉG_1]", "[cég 1]", "[SZEMELY_1]", "{PERSON 2}",
 * "[BANK ACCOUNT_1]", and without brackets with an underscore: "SZEMÉLY_1". Groups: kind and number, bracketed
 * (1, 2) or bare (3, 4). Only kinds known in KIND_ALIASES count, so "[Melléklet 1]" or "[5.2.]" are ordinary text.
 */
const PLACEHOLDER_LIKE = /[[{]\s*(\p{L}[\p{L} _-]{0,40}?)[\s_-]*(\d{1,4})\.?\s*[\]}]|(?<![\p{L}\p{N}_])(\p{L}+(?:_\p{L}+)*)_(\d{1,4})(?![\p{L}\p{N}])/gu;
/** A placeholder cut in half at the end of a streamed chunk, e.g. "[CÉG_" or "[cég 1" */
const PARTIAL_TOKEN = /[[{][\p{L}\s_-]*\d*\.?\s*$/u;

/** The canonical placeholder ("[SZEMÉLY_1]") a match stands for; null when it is not a placeholder at all */
function canonicalToken(match: RegExpMatchArray | string[]): string | null {
  const kind = KIND_ALIASES[normalizeKind(match[1] ?? match[3] ?? '')];
  const number = match[2] ?? match[4];
  return kind && number ? `[${kind}_${Number(number)}]` : null;
}

export class Masker {
  private forward = new Map<string, string>();
  private reverse = new Map<string, string>();
  private counters = new Map<EntityKind, number>();
  private kinds = new Map<string, EntityKind>();
  /** Placeholder-like text already in the document ("[CÉG_1]" in a template): never used as our own token */
  private reserved = new Set<string>();
  /** Surnames masked only where they stand for the person ("Kovács úr"), never everywhere ("Magyar Nemzeti Bank") */
  private contextual = new Set<string>();
  private extraTerms: string[];
  private neverHide: Set<string>;

  /**
   * extraTerms: the user's own list of words to always hide (names, project codes…).
   * neverHide: values the rules recognize but the user wants the AI to see (e.g. a public authority's name).
   */
  constructor(extraTerms: string[] = [], neverHide: string[] = []) {
    this.extraTerms = extraTerms.map(t => t.trim()).filter(t => t.length >= 2).sort((a, b) => b.length - a.length);
    this.neverHide = new Set(neverHide.map(t => t.trim()).filter(Boolean));
  }

  private tokenFor(value: string, kind: EntityKind, contextual = false): string {
    const existing = this.forward.get(value);
    if (existing) return existing;
    if (contextual) this.contextual.add(value);
    let n = this.counters.get(kind) ?? 0;
    do n++; while (this.reserved.has(`[${kind}_${n}]`));
    this.counters.set(kind, n);
    const token = `[${kind}_${n}]`;
    this.forward.set(value, token);
    this.reverse.set(token, value);
    this.kinds.set(token, kind);
    return token;
  }

  /**
   * Remembers placeholder-like text that is already in the texts to be sent, so our own tokens never take the same
   * name: the AI's answer could not be told apart from it otherwise. Call it with every field before masking any.
   */
  reserve(texts: string[]) {
    for (const text of texts) {
      for (const match of text.matchAll(PLACEHOLDER_LIKE)) {
        const token = canonicalToken(match);
        if (token && !this.reverse.has(token)) this.reserved.add(token);
      }
    }
  }

  /** Replaces sensitive values with placeholders */
  mask(text: string): string {
    if (!text) return text;
    this.reserve([text]);
    // The add-in's own section headers ("=== AROUND THE SELECTION … ===") are left alone
    if (/^===.*===$/m.test(text)) {
      return text.split('\n').map(line => (/^===.*===$/.test(line) ? line : this.maskText(line))).join('\n');
    }
    return this.maskText(text);
  }

  private maskText(text: string): string {
    if (!text) return text;
    // Invisible characters inside a name or a number ("Ko\u200Bvács") would hide it from every rule
    let result = stripControlChars(text);
    // The user's own terms first, then values already seen (so a name found in one field is hidden in all)
    for (const term of this.extraTerms) {
      result = result.split(term).join(this.tokenFor(term, 'EGYÉB'));
    }
    for (const rule of RULES) {
      result = result.replace(rule.pattern, (...args) => {
        const match = args[0] as string;
        const value = rule.group ? (args[rule.group] as string | undefined) : match;
        if (!value || /\[[A-ZÁÉÍÓÖŐÚÜŰ]+_\d+\]/.test(value) || this.neverHide.has(value.trim()) || (rule.accept && !rule.accept(value))) return match;
        return match.replace(value, this.tokenFor(value.trim(), rule.kind));
      });
    }
    // A person's surname alone, where it clearly means that person: "Kovács úr", "Kovácsné", "dr. Kovács"
    for (const [value, token] of [...this.forward]) {
      const surname = this.kinds.get(token) === 'SZEMÉLY' && !this.contextual.has(value) ? surnameOf(value) : null;
      if (surname) result = result.replace(surnameUse(surname), () => this.tokenFor(surname, 'SZEMÉLY', true));
    }
    // A company is often named later without its legal form ("a Napfény Invest"): a name of several words is hidden too
    for (const [value, token] of [...this.forward]) {
      const core = this.kinds.get(token) === 'CÉG' && !this.contextual.has(value) ? companyCore(value) : null;
      if (core && result.includes(core)) result = result.split(core).join(this.tokenFor(core, 'CÉG', true));
    }
    // Values already found are hidden wherever they occur, also in capitals ("KOVÁCS JÁNOS" in a signature block)
    for (const [value, token] of [...this.forward].sort((a, b) => b[0].length - a[0].length)) {
      if (value.length < 4 || this.contextual.has(value)) continue;
      result = result.split(value).join(token);
      const kind = this.kinds.get(token)!;
      const upper = value.toUpperCase();
      if ((kind === 'SZEMÉLY' || kind === 'CÉG') && upper !== value && result.includes(upper)) {
        result = result.split(upper).join(this.tokenFor(upper, kind));
      }
    }
    return result;
  }

  /**
   * Puts the original values back, also where the AI mangled a placeholder ("[cég 1]", "[PERSON_1]"); a
   * half-arrived placeholder at the end is hidden until it completes. What cannot be resolved stays as it is:
   * unresolvedPlaceholders finds it, so it never reaches the document.
   */
  unmask(text: string, streaming = false): string {
    if (!text) return text;
    const restored = text.replace(PLACEHOLDER_LIKE, (...match) => {
      const token = canonicalToken(match as unknown as string[]);
      return (token && this.reverse.get(token)) ?? match[0];
    });
    return streaming ? restored.replace(PARTIAL_TOKEN, '') : restored;
  }

  get count(): number {
    return this.forward.size;
  }

  /** [placeholder, original value] pairs, in the order they were found */
  entries(): [string, string][] {
    return [...this.reverse];
  }

  /** "2 cégnév, 1 e-mail-cím" – what the AI did not see */
  summary(): string {
    const byKind = new Map<EntityKind, number>();
    for (const kind of this.kinds.values()) byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    return [...byKind].map(([kind, n]) => `${n} ${ENTITY_LABELS[kind]}`).join(', ');
  }
}

/** Masks every text field of a request (the instruction and the user's style notes too) */
export function maskRequest(request: AIRequestBody, masker: Masker): AIRequestBody {
  masker.reserve([
    request.instruction, request.originalText, request.documentContext, request.styleProfile?.notes ?? '', request.party ?? '',
    ...(request.history ?? []).flatMap(turn => [turn.instruction, turn.result]),
  ]);
  return {
    ...request,
    instruction: masker.mask(request.instruction),
    originalText: masker.mask(request.originalText),
    documentContext: masker.mask(request.documentContext),
    history: request.history?.map(turn => ({ instruction: masker.mask(turn.instruction), result: masker.mask(turn.result) })),
    styleProfile: request.styleProfile && { ...request.styleProfile, notes: masker.mask(request.styleProfile.notes) },
    // A party given by name ("ABC Kft.") gets the same placeholder as in the text
    party: request.party && masker.mask(request.party),
    masked: true,
    // Only the count; the server's audit log never sees the values
    get maskedValues() { return masker.count; },
  };
}

/**
 * Placeholders still in an unmasked answer, in any spelling: the AI made them up or mangled them beyond
 * recognition, so there is no real value behind them. Text that also stands in the sources (what was sent, before
 * masking: the document, the instruction) is the document's own and does not count. Anything found here must never
 * be written into the document.
 */
export function unresolvedPlaceholders(texts: string | string[], sources: string[] = []): string[] {
  const found = new Set<string>();
  for (const text of [texts].flat()) {
    for (const match of text.matchAll(PLACEHOLDER_LIKE)) {
      if (canonicalToken(match) && !sources.some(source => source.includes(match[0]))) found.add(match[0]);
    }
  }
  return [...found];
}

/** What the user is told when an answer is held back because of unresolved placeholders */
export const unresolvedMessage = (placeholders: string[]) =>
  `⛔ Ezt nem írom be a dokumentumba: a válaszban fel nem oldott helyettesítő maradt (${placeholders.join(', ')}). Mögötte nincs valódi adat, így hibás jelölés kerülne a szövegbe. Kérj másik változatot, vagy írd meg, mi álljon a helyén.`;

/** Splits the user's own list (one per line or comma separated) */
export const parseExtraTerms = (text: string) => text.split(/[\n,;]/).map(t => t.trim()).filter(Boolean);
