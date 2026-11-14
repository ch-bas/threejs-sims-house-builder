const isGitHubPages = process.env.GITHUB_PAGES === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  images: { unoptimized: true },
  // Every viewport corner holds a HUD panel, so the dev-tools badge always
  // lands on a control (bottom-left: the mode buttons on mobile, #300).
  devIndicators: false,
  // `npm run lint` is the lint gate (CI runs it with --max-warnings=0
  // before the build); Next's own pass during `next build` only ran it a
  // second time (#447).
  eslint: { ignoreDuringBuilds: true },
  // Reproducible builds (#594): Next's default buildId is random, so two
  // builds of the same commit differed in the HTML, the RSC payload, the
  // _next/<buildId>/ folder and therefore every CSP hash. CI names the build
  // after the commit; a local build is always 'dev'. Module and chunk ids
  // are already webpack's content-derived 'deterministic' ids in production,
  // but Next's entry modules hash their absolute path, so only builds from
  // the same checkout directory (the CI runner's) match byte for byte.
  generateBuildId: () => process.env.GITHUB_SHA || 'dev',
  ...(isGitHubPages && {
    basePath: '/threejs-sims-house-builder',
    assetPrefix: '/threejs-sims-house-builder/',
  }),
};

export default nextConfig;