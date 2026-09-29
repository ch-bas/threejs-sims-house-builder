const isGitHubPages = process.env.GITHUB_PAGES === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  images: { unoptimized: true },
  // Every viewport corner holds a HUD panel, so the dev-tools badge always
  // lands on a control (bottom-left: the mode buttons on mobile, #300).
  devIndicators: false,
  ...(isGitHubPages && {
    basePath: '/threejs-sims-house-builder',
    assetPrefix: '/threejs-sims-house-builder/',
  }),
};

export default nextConfig;