import { MAX_PARTY_CHARS } from '../shared/aiConfig';
import type { DocumentGraph } from './structure';

/** Usual names of contracting parties; offered when they appear in the document */
export const KNOWN_ROLES = [
  'Eladó', 'Vevő', 'Bérbeadó', 'Bérlő', 'Megbízó', 'Megbízott', 'Megrendelő', 'Vállalkozó', 'Szolgáltató', 'Ügyfél',
  'Kölcsönadó', 'Kölcsönvevő', 'Hitelező', 'Adós', 'Munkáltató', 'Munkavállaló', 'Licencadó', 'Licencvevő',
  'Ajándékozó', 'Megajándékozott', 'Zálogjogosult', 'Zálogkötelezett', 'Kezes', 'Átruházó', 'Engedményező', 'Engedményes',
  'Seller', 'Buyer', 'Lessor', 'Lessee', 'Landlord', 'Tenant', 'Licensor', 'Licensee', 'Supplier', 'Customer',
  'Contractor', 'Client', 'Employer', 'Employee', 'Lender', 'Borrower',
] as const;

/** Data that only a party block has: a company's or a person's identification */
const PARTY_DATA = /székhely|cégjegyzék|adószám|nyilvántartási szám|születési|anyja neve|lakcím|lakóhely|registered office|company registration|date of birth/i;
/** Collective names are not one side */
const COLLECTIVE = /^(Felek|Fél|Parties|Party)$/;
const MAX_SUGGESTIONS = 8;

const appears = (role: string, text: string) => new RegExp(`(?<![\\p{L}])${role}`, 'u').test(text);

/**
 * Who could be "our" party in this document: terms defined right after a party's identification data
 * ("ABC Kft. (székhely: …; a továbbiakban: Eladó)"), then the usual party names that occur in the text.
 */
export function partySuggestions(graph: DocumentGraph, paragraphs: string[]): string[] {
  const found: string[] = [];
  const add = (term: string) => {
    if (!COLLECTIVE.test(term) && !found.includes(term)) found.push(term);
  };
  for (const term of graph.terms) {
    if (term.kind === 'inline' && (PARTY_DATA.test(term.definition) || (KNOWN_ROLES as readonly string[]).includes(term.term))) add(term.term);
  }
  const text = paragraphs.join('\n');
  for (const role of KNOWN_ROLES) if (appears(role, text)) add(role);
  return found.slice(0, MAX_SUGGESTIONS);
}

/** One line, short: it goes into the AI's instructions */
export const cleanParty = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, MAX_PARTY_CHARS);

const STORAGE_KEY = 'word-writer-party-v1';
const MAX_REMEMBERED = 200;

/**
 * The represented party is a property of the document, but it is remembered on this machine (by the document's
 * path), never written into the file: a document sent to the other side must not carry our notes.
 */
export function loadParty(documentUrl: string): string {
  if (!documentUrl) return '';
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return typeof stored?.[documentUrl] === 'string' ? cleanParty(stored[documentUrl]) : '';
  } catch {
    return '';
  }
}

export function saveParty(documentUrl: string, party: string) {
  if (!documentUrl) return;
  try {
    const stored: Record<string, string> = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
    delete stored[documentUrl];
    if (party) stored[documentUrl] = party;
    // The oldest entries go first (insertion order)
    const entries = Object.entries(stored).slice(-MAX_REMEMBERED);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Not remembered, but it still applies in this session
  }
}
