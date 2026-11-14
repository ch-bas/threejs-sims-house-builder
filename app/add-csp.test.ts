import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { addPolicy } from '../scripts/add-csp.mjs';

// The post-build step that writes the Content-Security-Policy meta (#445).

const INLINE = 'self.__next_f.push([1,"x"])';

function sha(text: string): string {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

function page(head: string, body = ''): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/>${head}</head><body>${body}</body></html>`;
}

function policyOf(html: string): string {
  const match = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"\/>/.exec(html);
  if (!match?.[1]) throw new Error('no policy');
  return match[1];
}

function directive(html: string, name: string): string {
  return policyOf(html).split('; ').find((part) => part.startsWith(`${name} `)) ?? '';
}

describe('addPolicy', () => {
  it('hashes each inline script once and leaves external scripts to the source list', () => {
    const html = page(
      `<script src="/_next/static/chunks/main.js" async=""></script><script>${INLINE}</script>`,
      `<script>${INLINE}</script><script>self.__next_f.push([2])</script>`,
    );
    const out = addPolicy(html, 'index.html');
    expect(out.hashes).toBe(2);
    const scripts = directive(out.html, 'script-src');
    expect(scripts).toContain(sha(INLINE));
    expect(scripts).toContain(sha('self.__next_f.push([2])'));
    expect(scripts.split(' ').filter((part) => part === sha(INLINE))).toHaveLength(1);
  });

  it('skips JSON data blocks, which are not scripts', () => {
    const html = page('', '<script type="application/json">{"a":1}</script><script type="application/ld+json">{}</script>');
    const out = addPolicy(html, 'index.html');
    expect(out.hashes).toBe(0);
    expect(policyOf(out.html)).not.toContain('sha256-');
  });

  it('puts the policy right after the charset, ahead of every script', () => {
    const out = addPolicy(page(`<script>${INLINE}</script>`), 'index.html');
    const meta = out.html.indexOf('http-equiv="Content-Security-Policy"');
    expect(out.html.indexOf('<meta charSet="utf-8"/>')).toBeLessThan(meta);
    expect(meta).toBeLessThan(out.html.indexOf('<script'));
  });

  it('falls back to the head tag when the page has no charset', () => {
    const html = `<html><head><title>x</title><script>${INLINE}</script></head></html>`;
    const out = addPolicy(html, 'x.html');
    expect(out.html.startsWith('<html><head><meta http-equiv="Content-Security-Policy"')).toBe(true);
  });

  it('refuses a script ahead of the charset, which the policy would not govern', () => {
    const html = `<!DOCTYPE html><html><head><script>${INLINE}</script><meta charSet="utf-8"/></head></html>`;
    expect(() => addPolicy(html, 'early.html')).toThrow(/early\.html: a script precedes/);
  });

  it('refuses a page with no head', () => {
    expect(() => addPolicy('<p>hi</p>', 'bare.html')).toThrow(/bare\.html: no <head>/);
  });

  it('fails on an inline event handler, which no hash can allow', () => {
    const html = page('', '<button type="button" onclick="go()">Go</button>');
    expect(() => addPolicy(html, 'index.html')).toThrow(/inline event handler blocked by the CSP: <button/);
  });

  it('does not mistake handler-like text inside a script for a handler', () => {
    const html = page(`<script>var s='<a onclick="x">';</script>`);
    expect(() => addPolicy(html, 'index.html')).not.toThrow();
  });

  it('replaces its own policy when run again on a patched page', () => {
    const html = page(`<script>${INLINE}</script>`);
    const once = addPolicy(html, 'index.html').html;
    const twice = addPolicy(once, 'index.html').html;
    expect(twice).toBe(once);
    expect(twice.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
  });

  it('keeps the fixed directives', () => {
    const policy = policyOf(addPolicy(page(''), 'index.html').html);
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("img-src 'self' data:");
  });
});
