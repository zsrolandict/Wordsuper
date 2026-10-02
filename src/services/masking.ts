import type { AIRequestBody } from '../shared/aiConfig';

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
const L = 'a-záéíóöőúüű';
const NAME_WORD = `[${U}][${L}]+(?:-[${U}][${L}]+)?`;
const LEGAL_FORMS = 'Kft|Zrt|Nyrt|Bt|Kkt|Kht|Ltd|GmbH|Inc|LLC|Plc|AG|SE';
const PERSON_KEYWORDS = ['név', 'neve', 'nevű', 'képviseli', 'képviselő', 'képviseletében', 'ügyvezető', 'aláíró', 'meghatalmazott', 'tulajdonos', 'eladó', 'vevő', 'bérlő', 'bérbeadó', 'megbízó', 'megbízott']
  .map(word => `[${word[0]}${word[0].toUpperCase()}]${word.slice(1)}`)
  .join('|');

interface Rule {
  kind: EntityKind;
  pattern: RegExp;
  /** Capture group holding the value to mask; the whole match when omitted */
  group?: number;
}

// Order matters: specific identifiers first, so e.g. a tax number is not taken for a phone number
const RULES: Rule[] = [
  { kind: 'EMAIL', pattern: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  { kind: 'SZÁMLA', pattern: /\bHU\d{2}(?:\s?\d{4}){6}\b/g },
  { kind: 'SZÁMLA', pattern: /\b\d{8}-\d{8}(?:-\d{8})?\b/g },
  { kind: 'ADÓSZÁM', pattern: /\b\d{8}-\d-\d{2}\b/g },
  { kind: 'ADÓSZÁM', pattern: /(?<!\d)8\d{9}(?!\d)/g },
  { kind: 'CÉGJEGYZÉK', pattern: /(?:Cg\.\s*)?\b\d{2}-\d{2}-\d{6}\b/g },
  { kind: 'TELEFON', pattern: /(?:\+36|\b06)[\s\-/]?\(?\d{1,2}\)?[\s\-/]?\d{3}[\s-]?\d{3,4}\b/g },
  { kind: 'AZONOSÍTÓ', pattern: /\bTAJ(?:\s*szám)?\s*:?\s*(\d{3}\s?\d{3}\s?\d{3})\b/gu, group: 1 },
  { kind: 'AZONOSÍTÓ', pattern: /\b\d{6}[A-Z]{2}\b/g },
  { kind: 'SZÜLETÉS', pattern: /\bszül(?:\.|etett|etési idő)\s*:?\s*(?:[^,;\d]{0,30},\s*)?(\d{4}\.\s*(?:\d{1,2}|[a-zá-ű]+)\.?\s*\d{1,2}\.?)/giu, group: 1 },
  { kind: 'HRSZ', pattern: /\b(?:hrsz\.?|helyrajzi\s+sz(?:ámú|ámon|ám)?\.?)\s*:?\s*(\d+(?:\/\d+)*(?:\/[A-Z]\/\d+)?)/giu, group: 1 },
  // 1111 Budapest, Fő utca 1. / 2600 Vác, Széchenyi u. 12/A
  {
    kind: 'CÍM',
    pattern: new RegExp(`\\b\\d{4}\\s+[${U}][\\p{L}-]+,?\\s+[^,;()\\n]{1,60}?\\s(?:utca|út|útja|tér|tere|körút|krt\\.|u\\.|köz|sor|sétány|fasor|park|dűlő|lakótelep|lépcső)\\s*\\d+(?:[/-]?[A-Za-z0-9]+)*\\.?`, 'gu'),
  },
  // Companies: capitalized words before a legal form (the article in front is not part of the name)
  {
    kind: 'CÉG',
    pattern: new RegExp(`(?<![\\p{L}\\d])(?!(?:A|Az|The)\\s)((?:[${U}0-9][\\p{L}0-9&.\\-]*\\s+){0,5}[${U}0-9][\\p{L}0-9&.\\-]*\\s+(?:${LEGAL_FORMS})(?![\\p{L}\\d])\\.?)`, 'gu'),
    group: 1,
  },
  // People after a telltale word: "képviseli: dr. Kiss Anna", "név: Nagy Péter", "ügyvezető Kovács János".
  // Case-sensitive on purpose: only capitalized words count as a name ("… Anna ügyvezető" keeps "ügyvezető").
  {
    kind: 'SZEMÉLY',
    pattern: new RegExp(`(?<![\\p{L}])(?:${PERSON_KEYWORDS})\\s*:?\\s+((?:[dD]r\\.\\s+)?${NAME_WORD}(?:\\s+${NAME_WORD}){1,2})`, 'gu'),
    group: 1,
  },
];

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

  private tokenFor(value: string, kind: EntityKind): string {
    const existing = this.forward.get(value);
    if (existing) return existing;
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
    let result = text;
    // The user's own terms first, then values already seen (so a name found in one field is hidden in all)
    for (const term of this.extraTerms) {
      result = result.split(term).join(this.tokenFor(term, 'EGYÉB'));
    }
    for (const rule of RULES) {
      result = result.replace(rule.pattern, (...args) => {
        const match = args[0] as string;
        const value = rule.group ? (args[rule.group] as string | undefined) : match;
        if (!value || /\[[A-ZÁÉÍÓÖŐÚÜŰ]+_\d+\]/.test(value) || this.neverHide.has(value.trim())) return match;
        return match.replace(value, this.tokenFor(value.trim(), rule.kind));
      });
    }
    for (const [value, token] of [...this.forward].sort((a, b) => b[0].length - a[0].length)) {
      if (value.length >= 4) result = result.split(value).join(token);
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
