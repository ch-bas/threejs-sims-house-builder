// Rebuilds the raster icons and the link-preview image from SVG. Not part of
// the app build: the outputs are committed, and Next picks them up from app/
// by file name (icon.svg, favicon.ico, apple-icon.png, opengraph-image.png),
// adding the GitHub Pages basePath to every link it writes.
//
//   npm i --no-save playwright && npx playwright install chromium
//   node scripts/build-icons.mjs
//
// Sources: app/icon.svg (the favicon, served as is) and the preview card
// below, which frames docs/images/editor-3d.png (the README screenshot).
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const ICON_SVG = await readFile('app/icon.svg', 'utf8');
const SCREENSHOT = await readFile('docs/images/editor-3d.png');

// iOS rounds the touch icon itself and fills transparency with black, so the
// apple icon is the same art on a square, full-bleed lot.
const SQUARE_ICON_SVG = ICON_SVG.replace('rx="14"', 'rx="0"');

const INK = '#1A2A33';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function previewCardSvg() {
  const shot = `data:image/png;base64,${SCREENSHOT.toString('base64')}`;
  const icon = `data:image/svg+xml;base64,${Buffer.from(ICON_SVG).toString('base64')}`;
  const text = (x, y, size, weight, fill, content) =>
    `<text x="${x}" y="${y}" font-family='${FONT}' font-size="${size}" font-weight="${weight}" fill="${fill}">${content}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="lot" cx="50%" cy="30%" r="80%">
      <stop offset="0" stop-color="#8DCC4C"/>
      <stop offset="0.55" stop-color="#6FB23A"/>
      <stop offset="1" stop-color="#4A8826"/>
    </radialGradient>
    <pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse">
      <path d="M64 0H0V64" fill="none" stroke="rgba(127,243,255,0.18)" stroke-width="2"/>
    </pattern>
    <clipPath id="shot"><rect x="610" y="100" width="720" height="450" rx="24"/></clipPath>
    <filter id="lift" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="${INK}" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect width="1200" height="630" fill="url(#lot)"/>
  <rect width="1200" height="630" fill="url(#grid)"/>
  <g filter="url(#lift)">
    <image href="${shot}" x="610" y="100" width="720" height="450" clip-path="url(#shot)" preserveAspectRatio="xMinYMin slice"/>
  </g>
  <rect x="610" y="100" width="720" height="450" rx="24" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="3"/>
  <image href="${icon}" x="64" y="88" width="112" height="112"/>
  ${text(64, 290, 58, 800, '#FFFFFF', 'Three.js Sims-like')}
  ${text(64, 358, 58, 800, '#FFFFFF', 'House Builder')}
  ${text(64, 420, 28, 600, INK, 'Build, furnish and walk through')}
  ${text(64, 458, 28, 600, INK, 'a house in your browser.')}
  ${text(64, 560, 22, 700, 'rgba(255,255,255,0.9)', 'ch-bas.github.io/threejs-sims-house-builder')}
</svg>`;
}

// A Windows icon holding PNG images (Vista and later read these).
function icoFromPngs(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((png) => png.data)]);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const render = async (svg, width, height) => {
    await page.setViewportSize({ width, height });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${width}px;height:${height}px}</style>${svg}`
    );
    return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width, height } });
  };

  const favicons = [];
  for (const size of [16, 32, 48]) favicons.push({ size, data: await render(ICON_SVG, size, size) });
  await writeFile('app/favicon.ico', icoFromPngs(favicons));
  await writeFile('app/apple-icon.png', await render(SQUARE_ICON_SVG, 180, 180));
  await writeFile('app/opengraph-image.png', await render(previewCardSvg(), 1200, 630));
  console.warn('wrote app/favicon.ico, app/apple-icon.png, app/opengraph-image.png');
} finally {
  await browser.close();
}
