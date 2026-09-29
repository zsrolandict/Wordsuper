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
    }))
    .filter(f => f.quote && f.comment)
    .slice(0, MAX_REVIEW_FINDINGS);
}

// Word's search fails on strings longer than 255 characters
const MAX_SEARCH_CHARS = 255;

/** The quote without the quotation marks the model sometimes wraps it in, whitespace collapsed */
export const cleanQuote = (quote: string) =>
  quote.replace(/\s+/g, ' ').trim().replace(/^["'„“”«»]+|["'„“”«»]+$/g, '').trim();

/**
 * Search strings to locate a quote in the document, most specific first.
 * The model sometimes changes quotes or whitespace, so shorter prefixes are tried too.
 */
export function searchCandidates(quote: string): string[] {
  const clean = cleanQuote(quote);
  const words = clean.split(' ');
  const candidates = [clean, words.slice(0, 8).join(' '), words.slice(0, 4).join(' ')]
    .map(c => c.substring(0, 200).trim())
    .filter(c => c.length >= 3)
    // ^ starts a special character code in Word search (^p, ^t…), ^^ is a literal caret
    .map(c => c.replace(/\^/g, '^^'))
    .filter(c => c.length <= MAX_SEARCH_CHARS);
  return [...new Set(candidates)];
}

export const SEVERITY_LABELS: Record<Severity, string> = {
  high: 'Magas',
  medium: 'Közepes',
  low: 'Alacsony',
};
