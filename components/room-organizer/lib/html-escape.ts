/**
 * What XML 1.0 forbids even as a character reference: the C0 controls but tab,
 * LF and CR, lone surrogates and U+FFFE/U+FFFF. With the `u` flag a surrogate
 * pair is one code point above the range, so an emoji is not touched.
 */
// eslint-disable-next-line no-control-regex
const XML_ILLEGAL = /[\u{0}-\u{8}\u{B}\u{C}\u{E}-\u{1F}\u{D800}-\u{DFFF}\u{FFFE}\u{FFFF}]/gu;

/** `input` without the characters an XML file cannot hold (#549). */
export function stripXmlIllegal(input: string): string {
  return input.replace(XML_ILLEGAL, '');
}

/**
 * Escape text for HTML or XML content and attribute values: `&`, `<`, `>`,
 * `"` and `'`, dropping what XML cannot hold at all (#549): a stored name keeps
 * any string, and one such character makes a whole SVG unreadable. The one
 * copy shared by the blueprint and print popups and the SVG exporter (#451).
 */
export function escapeHtml(input: string): string {
  return stripXmlIllegal(input).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
