import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { zipStored } from '../src/services/docxWriter';
import { clauseFromDocx, graphTokenFor, readClauseFolder, readSharePointClauses, shareId } from './clauses';

/** A minimal .docx with these paragraphs */
export function docx(...paragraphs: string[]): Uint8Array {
  const body = paragraphs.map(p => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  return zipStored([{ name: 'word/document.xml', data: new TextEncoder().encode(xml) }]);
}
const buffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

test('a clause from a .docx: the file name is the title, the paragraphs the text', async () => {
  const clause = await clauseFromDocx(buffer(docx('Vis maior', '', 'Egyik fél sem felel…')), 'Vis_maior_zaradek.docx', 'Általános', 'x');
  assert.deepEqual(clause, { id: 'x', title: 'Vis maior zaradek', category: 'Általános', text: 'Vis maior\nEgyik fél sem felel…' });
  assert.equal(await clauseFromDocx(new ArrayBuffer(10), 'rossz.docx', '', 'y'), null);
});

test('a folder (e.g. a synced SharePoint library): sub-folders are categories, Word temp files skipped', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clauses-'));
  fs.writeFileSync(path.join(dir, 'Titoktartás.docx'), docx('A felek titoktartásra kötelesek.'));
  fs.writeFileSync(path.join(dir, '~$Titoktartás.docx'), 'lock');
  fs.writeFileSync(path.join(dir, 'jegyzet.txt'), 'nem záradék');
  fs.mkdirSync(path.join(dir, 'Ingatlan'));
  fs.writeFileSync(path.join(dir, 'Ingatlan', 'Birtokbaadás.docx'), docx('Az Eladó az Ingatlant…'));
  const { clauses, problem } = await readClauseFolder(dir, 1);
  assert.equal(problem, undefined);
  assert.deepEqual(clauses.map(c => [c.category, c.title]), [['', 'Titoktartás'], ['Ingatlan', 'Birtokbaadás']]);
  assert.match((await readClauseFolder(path.join(dir, 'nincs'), 2)).problem!, /cannot be read/);
  fs.rmSync(dir, { recursive: true });
});

test('SharePoint: the share id Graph expects', () => {
  assert.equal(shareId('https://iroda.sharepoint.com/sites/Jog/Shared Documents/Zaradekok'), `u!${Buffer.from('https://iroda.sharepoint.com/sites/Jog/Shared Documents/Zaradekok').toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')}`);
  assert.doesNotMatch(shareId('https://a.b/c?d=e>f'), /[=+/]/);
});

test('SharePoint: on-behalf-of exchange with the user token, kept until it expires', async () => {
  const calls: { url: string; body: string }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body) });
    return new Response(JSON.stringify({ access_token: 'graph-1', expires_in: 3600 }), { status: 200 });
  }) as typeof fetch;
  const config = { tenantId: 't', clientId: 'c', clientSecret: 's', folderUrl: 'u' };
  assert.equal(await graphTokenFor('office-token', 'anna@iroda.hu', config, fakeFetch, 1000), 'graph-1');
  assert.equal(await graphTokenFor('office-token', 'anna@iroda.hu', config, fakeFetch, 2000), 'graph-1');
  assert.equal(calls.length, 1, 'cached');
  assert.equal(calls[0].url, 'https://login.microsoftonline.com/t/oauth2/v2.0/token');
  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  assert.equal(body.get('assertion'), 'office-token');
  assert.equal(body.get('requested_token_use'), 'on_behalf_of');
  const refused = (async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'AADSTS65001: consent\nTrace' }), { status: 400 })) as typeof fetch;
  await assert.rejects(graphTokenFor('t2', 'peter@iroda.hu', config, refused), /Graph sign-in failed: invalid_grant \(AADSTS65001: consent\)/);
});

test('SharePoint: the folder and one level of sub-folders, the files read with the user rights', async () => {
  const items: Record<string, unknown> = {
    root: { id: 'root', name: 'Zaradekok', parentReference: { driveId: 'D' } },
    'children:root': { value: [{ id: 'f1', name: 'Vis maior.docx', file: {}, size: 100 }, { id: 'sub', name: 'Ingatlan', folder: {} }, { id: 'x', name: 'kép.png', file: {} }] },
    'children:sub': { value: [{ id: 'f2', name: 'Birtokbaadás.docx', file: {}, size: 100 }] },
  };
  const auth: string[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    auth.push((init.headers as Record<string, string>).Authorization);
    if (url.includes('/shares/')) return new Response(JSON.stringify(items.root));
    const child = /items\/(\w+)\/children/.exec(url);
    if (child) return new Response(JSON.stringify(items[`children:${child[1]}`]));
    const content = /items\/(\w+)\/content/.exec(url);
    if (content) return new Response(docx(content[1] === 'f1' ? 'Egyik fél sem felel.' : 'Birtokbaadás a vételár megfizetésekor.'));
    return new Response('', { status: 404 });
  }) as typeof fetch;
  const clauses = await readSharePointClauses('graph-token', 'https://iroda.sharepoint.com/x', fakeFetch);
  assert.deepEqual(clauses.map(c => [c.category, c.title, c.text]), [['', 'Vis maior', 'Egyik fél sem felel.'], ['Ingatlan', 'Birtokbaadás', 'Birtokbaadás a vételár megfizetésekor.']]);
  assert.ok(auth.every(a => a === 'Bearer graph-token'));
});
