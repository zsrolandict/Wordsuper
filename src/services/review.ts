import { MAX_REVIEW_FINDINGS, SEVERITY_VALUES, type ReviewFinding, type Severity } from '../shared/aiConfig';

/** Parses the review JSON; null when it isn't a list of findings */
export function parseFindings(text: string): ReviewFinding[] | null {
  let data: unknown;
  try {
    // Tolerate a ```json fence even though the schema asks for plain JSON
    data = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  return data
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map(f => ({
      quote: typeof f.quote === 'string' ? f.quote.trim() : '',
      comment: typeof f.comment === 'string' ? f.comment.trim() : '',
      severity: (SEVERITY_VALUES as readonly unknown[]).includes(f.severity) ? (f.severity as Severity) : 'medium',
      suggestion: typeof f.suggestion === 'string' ? f.suggestion.trim() : '',
    }))
    .filter(f => f.quote && f.comment)
    .slice(0, MAX_REVIEW_FINDINGS);
}

// Word's search fails on strings longer than 255 characters
const MAX_SEARCH_CHARS = 255;
/** A fix replaces the whole quote, so the whole quote must fit into one search */
const MAX_FIX_CHARS = 250;
const WRAPPING_QUOTES = /^["'„“”«»]+|["'„“”«»]+$/g;

/** The quote without the quotation marks the model sometimes wraps it in, whitespace collapsed */
export const cleanQuote = (quote: string) =>
  quote.replace(/\s+/g, ' ').trim().replace(WRAPPING_QUOTES, '').trim();

/**
 * Search strings to locate a quote in the document, most specific first.
 * The model sometimes changes quotes or whitespace, so shorter prefixes are tried too; and it sometimes quotes
 * across a paragraph break, which Word's search can't match, so each sentence is tried as well (longest first).
 */
export function searchCandidates(quote: string): string[] {
  const clean = cleanQuote(quote);
  const words = clean.split(' ');
  const sentences = clean
    .split(/(?<=[.!?;:])\s+/)
    .filter(sentence => sentence !== clean)
    .sort((a, b) => b.length - a.length);
  const candidates = [clean, words.slice(0, 8).join(' '), ...sentences, words.slice(0, 4).join(' ')]
    .map(c => c.substring(0, MAX_FIX_CHARS).trim())
    .filter(c => c.length >= 3)
    // ^ starts a special character code in Word search (^p, ^t…), ^^ is a literal caret
    .map(c => c.replace(/\^/g, '^^'))
    .filter(c => c.length <= MAX_SEARCH_CHARS);
  return [...new Set(candidates)];
}

export interface ReviewFix {
  /** Word search string for the whole quote */
  search: string;
  /** What the quote is replaced with */
  replacement: string;
}

/**
 * The tracked change a finding proposes, or null when it has none (or its quote is too long to be found whole).
 * Quotation marks the model wrapped around the quote are dropped from the suggestion too, so they aren't doubled.
 */
export function reviewFix(finding: ReviewFinding): ReviewFix | null {
  if (!finding.suggestion.trim()) return null;
  const collapsed = finding.quote.replace(/\s+/g, ' ').trim();
  const leading = collapsed.match(/^["'„“”«»]+/)?.[0] ?? '';
  const trailing = collapsed.match(/["'„“”«»]+$/)?.[0] ?? '';
  let replacement = finding.suggestion.trim();
  if (leading && replacement.startsWith(leading)) replacement = replacement.slice(leading.length);
  if (trailing && replacement.endsWith(trailing)) replacement = replacement.slice(0, -trailing.length);
  replacement = replacement.trim();
  const quote = cleanQuote(finding.quote);
  if (quote.length < 3 || quote.length > MAX_FIX_CHARS || replacement === quote) return null;
  const search = quote.replace(/\^/g, '^^');
  return search.length <= MAX_SEARCH_CHARS ? { search, replacement } : null;
}

/** The margin note; the proposed wording goes into it when the fix is not written into the text */
export const reviewCommentText = (finding: ReviewFinding, fixApplied: boolean) =>
  finding.suggestion && !fixApplied ? `${finding.comment}\nJavasolt szöveg: „${finding.suggestion}”` : finding.comment;

export const SEVERITY_LABELS: Record<Severity, string> = {
  high: 'Magas',
  medium: 'Közepes',
  low: 'Alacsony',
};
