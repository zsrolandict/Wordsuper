import fs from "fs";
import path from "path";
import { readDocxParagraphs } from "../src/services/docxText";

/**
 * The firm's model clauses (záradéktár). One .docx = one clause: its file name is the title, its sub-folder the
 * category. Two sources:
 * - CLAUSES_DIR: a folder on the server's machine, e.g. a SharePoint library synced by OneDrive (local mode);
 * - CLAUSES_SHAREPOINT_URL: a SharePoint folder read through Microsoft Graph with the signed-in user's own rights
 *   (on-behalf-of the Office sign-in token; needs MS_CLIENT_SECRET and the Files.Read.All delegated permission).
 *   Everyone sees only the clauses they may open in SharePoint.
 */

export interface Clause {
  id: string;
  title: string;
  /** The sub-folder, "" at the top */
  category: string;
  text: string;
}

export const MAX_CLAUSES = 300;
export const MAX_CLAUSE_CHARS = 20000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const titleOf = (fileName: string) => fileName.replace(/\.docx$/i, '').replace(/[_]+/g, ' ').trim();

/** A clause from a .docx's bytes; null when it is empty or not a Word file */
export async function clauseFromDocx(bytes: ArrayBuffer, fileName: string, category: string, id: string): Promise<Clause | null> {
  try {
    const paragraphs = (await readDocxParagraphs(bytes)).map(p => p.trim()).filter(Boolean);
    const text = paragraphs.join('\n').slice(0, MAX_CLAUSE_CHARS);
    return text ? { id, title: titleOf(fileName), category, text } : null;
  } catch {
    return null;
  }
}

// ---------- A folder on this machine ----------

let folderCache: { key: string; at: number; clauses: Clause[] } | null = null;

/** The .docx files of the folder and its sub-folders (one level), read again at most once a minute */
export async function readClauseFolder(dir: string, now = Date.now()): Promise<{ clauses: Clause[]; problem?: string }> {
  if (folderCache && folderCache.key === dir && now - folderCache.at < 60_000) return { clauses: folderCache.clauses };
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    return { clauses: [], problem: `CLAUSES_DIR (${dir}) cannot be read: ${(error as Error).message}` };
  }
  const files: { file: string; category: string }[] = [];
  for (const entry of entries) {
    if (entry.isFile() && /\.docx$/i.test(entry.name) && !entry.name.startsWith('~$')) files.push({ file: path.join(dir, entry.name), category: '' });
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      try {
        for (const inner of fs.readdirSync(path.join(dir, entry.name), { withFileTypes: true })) {
          if (inner.isFile() && /\.docx$/i.test(inner.name) && !inner.name.startsWith('~$')) files.push({ file: path.join(dir, entry.name, inner.name), category: entry.name });
        }
      } catch {
        // an unreadable sub-folder is skipped
      }
    }
  }
  const clauses: Clause[] = [];
  for (const { file, category } of files.slice(0, MAX_CLAUSES)) {
    try {
      if (fs.statSync(file).size > MAX_FILE_BYTES) continue;
      const data = fs.readFileSync(file);
      const clause = await clauseFromDocx(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), path.basename(file), category, `f-${clauses.length}`);
      if (clause) clauses.push(clause);
    } catch {
      // a locked or half-synced file is skipped this time
    }
  }
  clauses.sort((a, b) => a.category.localeCompare(b.category, 'hu') || a.title.localeCompare(b.title, 'hu'));
  folderCache = { key: dir, at: now, clauses };
  return { clauses };
}

// ---------- SharePoint through Microsoft Graph ----------

export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** The SharePoint folder's address, as copied from the browser or "Copy link" */
  folderUrl: string;
}

type Fetch = typeof fetch;
const GRAPH = 'https://graph.microsoft.com/v1.0';

/** Graph's id for a shared address: "u!" + the URL in base64url without padding */
export const shareId = (url: string) => `u!${Buffer.from(url, 'utf8').toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')}`;

const graphTokens = new Map<string, { token: string; expires: number }>();

/** The user's Office token exchanged for a Graph token (on-behalf-of), kept until shortly before it expires */
export async function graphTokenFor(userToken: string, user: string, config: GraphConfig, fetchImpl: Fetch = fetch, now = Date.now()): Promise<string> {
  const cached = graphTokens.get(user);
  if (cached && cached.expires - 60_000 > now) return cached.token;
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    assertion: userToken,
    scope: 'https://graph.microsoft.com/Files.Read.All',
    requested_token_use: 'on_behalf_of',
  });
  const response = await fetchImpl(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const data = await response.json().catch(() => null) as { access_token?: string; expires_in?: number; error?: string; error_description?: string } | null;
  if (!response.ok || !data?.access_token) throw new Error(`Graph sign-in failed: ${data?.error ?? response.status}${data?.error_description ? ` (${data.error_description.split('\n')[0]})` : ''}`);
  graphTokens.set(user, { token: data.access_token, expires: now + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}

interface DriveItem { id: string; name: string; size?: number; folder?: unknown; file?: unknown; parentReference?: { driveId?: string } }

/** The clauses in the SharePoint folder (and its sub-folders, one level) that this user may open */
export async function readSharePointClauses(graphToken: string, folderUrl: string, fetchImpl: Fetch = fetch): Promise<Clause[]> {
  const get = async (url: string) => {
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${graphToken}` } });
    if (!response.ok) throw new Error(`SharePoint answered ${response.status} for ${url.replace(GRAPH, '')}`);
    return response;
  };
  const root = await (await get(`${GRAPH}/shares/${shareId(folderUrl)}/driveItem`)).json() as DriveItem;
  const driveId = root.parentReference?.driveId;
  if (!driveId) throw new Error('The SharePoint address is not a folder of a document library.');
  const children = async (itemId: string) =>
    ((await (await get(`${GRAPH}/drives/${driveId}/items/${itemId}/children?$top=200&$select=id,name,size,file,folder`)).json()) as { value?: DriveItem[] }).value ?? [];
  const files: { item: DriveItem; category: string }[] = [];
  for (const item of await children(root.id)) {
    if (item.file && /\.docx$/i.test(item.name)) files.push({ item, category: '' });
    if (item.folder) for (const inner of await children(item.id)) if (inner.file && /\.docx$/i.test(inner.name)) files.push({ item: inner, category: item.name });
  }
  const clauses: Clause[] = [];
  for (const { item, category } of files.slice(0, MAX_CLAUSES)) {
    if ((item.size ?? 0) > MAX_FILE_BYTES) continue;
    try {
      const bytes = await (await get(`${GRAPH}/drives/${driveId}/items/${item.id}/content`)).arrayBuffer();
      const clause = await clauseFromDocx(bytes, item.name, category, `sp-${item.id}`);
      if (clause) clauses.push(clause);
    } catch {
      // one unreadable file does not stop the rest
    }
  }
  return clauses.sort((a, b) => a.category.localeCompare(b.category, 'hu') || a.title.localeCompare(b.title, 'hu'));
}
