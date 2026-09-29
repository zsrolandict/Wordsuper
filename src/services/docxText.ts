/**
 * Reads the paragraphs of a .docx file in the browser, without a zip library: the zip directory is parsed by hand
 * and word/document.xml is inflated with the built-in DecompressionStream. The text is the "accepted" view:
 * tracked insertions are kept, tracked deletions and field codes are left out, like Word's paragraph.text.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Extracts one file from a zip archive, or null when it's not there */
export async function readZipEntry(buffer: ArrayBuffer, name: string): Promise<Uint8Array | null> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // The end-of-central-directory record sits in the last 64 KiB (after an optional comment)
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('Ez nem .docx (zip) fájl.');

  const entries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();

  for (let i = 0; i < entries; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) throw new Error('Sérült .docx fájl.');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const entryName = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    if (entryName === name) {
      if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) throw new Error('Sérült .docx fájl.');
      const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
      const data = bytes.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      throw new Error('Ismeretlen tömörítés a .docx fájlban.');
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) =>
    code[0] === '#'
      ? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10))
      : ENTITIES[code] ?? whole
  );

/** Paragraph texts of word/document.xml, in document order (table cells included) */
export function paragraphsFromDocumentXml(xml: string): string[] {
  const body = xml
    // Alternative content is stored twice (Choice + Fallback); text boxes hold nested paragraphs
    .replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, '')
    .replace(/<w:txbxContent\b[\s\S]*?<\/w:txbxContent>/g, '')
    // Tracked deletions are not part of the accepted text
    .replace(/<w:del\b[^>]*\/>/g, '')
    .replace(/<w:del\b[\s\S]*?<\/w:del>/g, '');

  const paragraphs: string[] = [];
  for (const match of body.matchAll(/<w:p\/>|<w:p[\s>][\s\S]*?<\/w:p>/g)) {
    let text = '';
    for (const token of match[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:br\s[^>]*\/>|<w:cr\/>/g)) {
      if (token[1] !== undefined) text += decodeEntities(token[1]);
      else if (token[0].startsWith('<w:tab')) text += '\t';
      // Word's paragraph.text shows a manual line break as \v
      else text += '\v';
    }
    paragraphs.push(text);
  }
  return paragraphs;
}

export async function readDocxParagraphs(buffer: ArrayBuffer): Promise<string[]> {
  const xml = await readZipEntry(buffer, 'word/document.xml');
  if (!xml) throw new Error('A fájlban nincs Word-dokumentum (word/document.xml).');
  return paragraphsFromDocumentXml(new TextDecoder().decode(xml));
}
