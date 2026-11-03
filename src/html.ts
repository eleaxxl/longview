// Google Calendar stores descriptions as HTML; this turns them into plain text for display and editing.

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });

const looksLikeHtml = (s: string) => /<\/?[a-z][^>]*>|&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(s);

/** Plain text for notes that may be HTML. Links keep their address when it differs from the text. */
export function htmlToText(s: string): string {
  if (!looksLikeHtml(s)) return s;
  const text = s
    .replace(/\r?\n/g, ' ')
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const label = inner.replace(/<[^>]*>/g, '').trim();
      const url = decode(href).replace(/^mailto:/i, '');
      return !label || decode(label) === url ? url : `${label}（${url}）`;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|tr|ul|ol|blockquote)>/gi, '\n')
    .replace(/<(p|div|h[1-6]|tr|ul|ol|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return decode(text)
    .split('\n')
    .map(l => l.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
