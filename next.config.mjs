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
  ...(isGitHubPages && {
    basePath: '/threejs-sims-house-builder',
    assetPrefix: '/threejs-sims-house-builder/',
  }),
};

export default nextConfig;