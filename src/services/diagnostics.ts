/**
 * What happened in the task pane, for an error report: errors and the requests' outcome, never the document's
 * text, the instruction or the answer. Kept in memory only (a reload starts empty), at most the last MAX_EVENTS.
 */

export interface DiagnosticEvent {
  time: string;
  kind: 'error' | 'request' | 'action';
  message: string;
}

const MAX_EVENTS = 200;
const MAX_MESSAGE = 240;
const events: DiagnosticEvent[] = [];

/**
 * A message without what could be the document's text: quoted pieces and long runs of words are replaced, numbers
 * that look like identifiers too. What stays is the kind of error and Word's or the server's own wording.
 */
export function scrub(message: string): string {
  return message
    .replace(/[„"“'][^„"“”']{12,}[”"']/g, '[szöveg]')
    .replace(/\b\d{6,}\b/g, '[szám]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[e-mail]')
    .replace(/(?:\b\p{L}+\b[ ,]+){12,}/gu, '[szöveg] ')
    .slice(0, MAX_MESSAGE);
}

export function recordEvent(kind: DiagnosticEvent['kind'], message: string) {
  events.push({ time: new Date().toISOString(), kind, message: scrub(message) });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

export const recentEvents = () => [...events];

const describe = (value: unknown) =>
  value instanceof Error ? `${value.name}: ${value.message}` : typeof value === 'string' ? value : value && typeof value === 'object' && 'code' in value ? `code ${(value as { code: unknown }).code}` : '';

let installed = false;
/** Catches uncaught errors and what the code logs as an error, from the start of the pane */
export function installDiagnostics() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', e => recordEvent('error', `Uncaught: ${describe(e.error) || e.message}`));
  window.addEventListener('unhandledrejection', e => recordEvent('error', `Unhandled: ${describe(e.reason)}`));
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const message = args.map(describe).filter(Boolean).join(' ');
    if (message) recordEvent('error', message);
    original(...args);
  };
}

export interface ReportContext {
  appVersion: string;
  server: unknown;
  settings: Record<string, unknown>;
  description: string;
}

/** Which Word API sets this Word supports: tells at once which features can work */
function apiSupport(): Record<string, string> {
  const result: Record<string, string> = {};
  const requirements = typeof Office !== 'undefined' ? Office.context?.requirements : undefined;
  if (!requirements) return result;
  const highest = (set: string, max: number) => {
    let best = '–';
    for (let minor = 1; minor <= max; minor++) if (requirements.isSetSupported(set, `1.${minor}`)) best = `1.${minor}`;
    return best;
  };
  result.WordApi = highest('WordApi', 9);
  result.WordApiDesktop = highest('WordApiDesktop', 4);
  return result;
}

/** The report: what runs where, the settings that matter (never the keys), and the recent events */
export function buildReport(context: ReportContext): string {
  const diagnostics = typeof Office !== 'undefined' ? Office.context?.diagnostics : undefined;
  return JSON.stringify({
    report: 'Word Writer hibajelentés',
    created: new Date().toISOString(),
    description: context.description.slice(0, 2000),
    app: context.appVersion,
    server: context.server,
    word: diagnostics ? { host: diagnostics.host, platform: diagnostics.platform, version: diagnostics.version } : null,
    api: apiSupport(),
    browser: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    settings: context.settings,
    events: recentEvents(),
  }, null, 2);
}
