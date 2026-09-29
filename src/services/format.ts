/** Hungarian number formatting: 52 345 */
export const formatNumber = (n: number) => n.toLocaleString('hu-HU');

// A Word a bekezdéseket \r-rel választja el, ezt a böngésző nem töri sorba
export const normalizeLineBreaks = (text: string) => text.replace(/\r\n?/g, '\n');
