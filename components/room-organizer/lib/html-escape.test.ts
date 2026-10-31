import { describe, expect, it } from 'vitest';
import { escapeHtml } from './html-escape';

describe('escapeHtml (#451)', () => {
  it('escapes the five characters that open markup or close an attribute', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });

  it('escapes an ampersand once, so an entity stays visible as typed', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('leaves everything else alone', () => {
    expect(escapeHtml('Maison d’été 東京 ☕ 10 m²')).toBe('Maison d’été 東京 ☕ 10 m²');
  });

  it('drops what XML 1.0 forbids, keeping tab, newlines and whole emoji (#549)', () => {
    expect(escapeHtml('a\u0000\u0008\u000b\u000c\u000e\u001f\ufffe\uffffb')).toBe('ab');
    expect(escapeHtml('lone \ud83d high, \ude00 low')).toBe('lone  high,  low');
    expect(escapeHtml('a\tb\nc\rd 😀')).toBe('a\tb\nc\rd 😀');
  });
});
