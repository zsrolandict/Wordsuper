const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Some browsers drop a download name with accents or dashes: the file name is kept to plain letters */
export const plainFileName = (name: string) =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ._()-]+/g, '-').replace(/\s+/g, ' ').trim();

/** Offers a .docx made in the pane as a download */
export function downloadDocx(bytes: Uint8Array, fileName: string) {
  downloadFile(bytes, fileName, DOCX_TYPE);
}

/** Offers any file made in the pane as a download */
export function downloadFile(content: Uint8Array | string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([content as BlobPart], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = plainFileName(fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** The open document's name without the extension ("Adásvételi szerződés"), '' for a new document */
export function documentName(): string {
  const url = typeof Office !== 'undefined' ? Office.context?.document?.url ?? '' : '';
  const name = decodeURIComponent(url.split(/[\\/]/).pop() ?? '');
  return name.replace(/\.(docx?|dotx?|docm|rtf)$/i, '');
}
