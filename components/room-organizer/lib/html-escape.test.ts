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
});
