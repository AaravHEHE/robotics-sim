// Escaping for text put into HTML strings. Anything from a file, a link or browser storage
// (robot profiles, plans) is untrusted: every value interpolated into innerHTML goes through esc().

/** Escape a value for use in HTML text or a double-quoted attribute. */
export const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
