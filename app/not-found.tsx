import type { Metadata } from 'next';

// The static export writes this as out/404.html, which GitHub Pages serves
// for any path it doesn't know. The way home is a plain link, a full page
// load: a next/link client navigation to the basePath root asks for
// `<basePath>.txt`, which the export doesn't write, and only falls back to
// a page load after that 404. The page is prerendered at build time, where
// GITHUB_PAGES says whether next.config.mjs set the basePath.
const HOME = process.env.GITHUB_PAGES === 'true' ? '/threejs-sims-house-builder/' : '/';

export const metadata: Metadata = {
  title: 'Page not found · Three.js Sims-like House Builder',
};

export default function NotFound(): JSX.Element {
  return (
    <main
      className="pc-world"
      style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', padding: 24 }}
    >
      <div
        className="pc-glass pc-glass--dark"
        style={{ padding: '28px 32px', textAlign: 'center', maxWidth: 440 }}
      >
        <h1
          style={{
            margin: '0 0 8px',
            fontFamily: 'var(--pc-font-display)',
            fontWeight: 700,
            color: 'var(--pc-paper)',
            letterSpacing: 'var(--pc-tr-caps)',
            textTransform: 'uppercase',
            fontSize: 16,
          }}
        >
          Nothing built here
        </h1>
        <p
          style={{
            margin: '0 0 16px',
            fontFamily: 'var(--pc-font-body)',
            color: 'var(--pc-paper-soft)',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          This page doesn’t exist. Head back to the builder to carry on with your house.
        </p>
        <a
          href={HOME}
          style={{
            display: 'inline-block',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            borderRadius: 8,
            padding: '10px 18px',
            fontFamily: 'var(--pc-font-display)',
            fontWeight: 700,
            letterSpacing: 'var(--pc-tr-caps)',
            textTransform: 'uppercase',
            fontSize: 12,
            textDecoration: 'none',
            background: 'var(--pc-cyan-glow, #22d3ee)',
            color: '#0f172a',
          }}
        >
          Back to the builder
        </a>
      </div>
    </main>
  );
}
