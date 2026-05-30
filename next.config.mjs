const isGitHubPages = process.env.GITHUB_PAGES === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  images: { unoptimized: true },
  ...(isGitHubPages && {
    basePath: '/threejs-sims-house-builder',
    assetPrefix: '/threejs-sims-house-builder/',
  }),
};

export default nextConfig;