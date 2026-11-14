// Post-build size check (#732): gzips what the static export ships and
// compares it with the budgets in scripts/bundle-budget.json.
//
//   npm run build && node scripts/check-bundle.mjs [--report-only] [--update] [outDir] [distDir]
//
// Three numbers, in gzip bytes (node:zlib, level 9, so they are stable):
// - firstLoadJs: every chunk a first visit to / downloads, which is the
//   scripts out/index.html loads (minus the nomodule polyfills a modern
//   browser skips) plus the editor and engine chunks app/page.tsx imports
//   as it starts (the loadable manifest, as scripts/add-preloads.mjs reads it);
// - largestChunk: the biggest single file under _next/static/chunks;
// - css: every stylesheet under _next/static/css.
//
// Going over a budget fails (with --report-only, as CI runs it for now, it
// is a warning), and the table names the largest files of that set. A deliberate increase edits bundle-budget.json in the same pull
// request (`--update` rewrites it at today's size plus the headroom), so the
// cost shows up in review. In CI the table also goes to the job summary.
import { appendFile, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { pageChunks } from './add-preloads.mjs';

export const METRICS = /** @type {const} */ (['firstLoadJs', 'largestChunk', 'css']);

const LABELS = {
  firstLoadJs: 'First-load JS',
  largestChunk: 'Largest chunk',
  css: 'CSS',
};

const SCRIPT_TAG_RE = /<script\b[^>]*>/gi;
const SRC_RE = /\bsrc="[^"]*?\/_next\/(static\/chunks\/[^"]+\.js)"/;

/** The chunk files (relative to out/_next) the page's script tags load. */
export function pageScripts(html) {
  const files = [];
  for (const [tag] of html.matchAll(SCRIPT_TAG_RE)) {
    if (/\bnomodule\b/i.test(tag)) continue;
    const file = SRC_RE.exec(tag)?.[1];
    if (file && !files.includes(file)) files.push(file);
  }
  return files;
}

/**
 * The three measured numbers from per-file gzip sizes (keys relative to
 * out/_next, e.g. "static/chunks/319.abc.js"), and the files behind each.
 */
export function measure(sizes, firstLoadFiles) {
  const chunks = Object.keys(sizes).filter((file) => file.startsWith('static/chunks/') && file.endsWith('.js'));
  const css = Object.keys(sizes).filter((file) => file.startsWith('static/css/') && file.endsWith('.css'));
  const missing = firstLoadFiles.filter((file) => !(file in sizes));
  if (missing.length > 0) throw new Error(`First-load files missing from the export: ${missing.join(', ')}`);
  const sum = (files) => files.reduce((total, file) => total + sizes[file], 0);
  const bySize = (files) => [...files].sort((a, b) => sizes[b] - sizes[a] || a.localeCompare(b));
  const largest = bySize(chunks)[0];
  return {
    firstLoadJs: { bytes: sum(firstLoadFiles), files: bySize(firstLoadFiles) },
    largestChunk: { bytes: largest ? sizes[largest] : 0, files: largest ? [largest] : [] },
    css: { bytes: sum(css), files: bySize(css) },
  };
}

/** The metrics over their budget. */
export function overBudget(measured, budget) {
  return METRICS.filter((metric) => measured[metric].bytes > budget[metric]);
}

/** Budgets at the measured size plus `headroom` (0.03 is 3%), rounded up to 1 KB. */
export function budgetFor(measured, headroom) {
  return Object.fromEntries(
    METRICS.map((metric) => [metric, Math.ceil((measured[metric].bytes * (1 + headroom)) / 1024) * 1024]),
  );
}

/**
 * What going over means: a failing error annotation, or with `reportOnly`
 * a warning that leaves the exit code alone. Null when nothing is over.
 */
export function verdict(over, reportOnly) {
  if (over.length === 0) return null;
  const message = `${over.map((metric) => LABELS[metric]).join(', ')} over budget: if the growth is deliberate, run \`npm run check:bundle -- --update\` and commit scripts/bundle-budget.json`;
  return reportOnly
    ? { annotation: `::warning title=Bundle budget::${message}`, exitCode: 0 }
    : { annotation: `::error title=Bundle budget::${message}`, exitCode: 1 };
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const shortName = (file) => file.replace(/^static\//, '');

/** A Markdown table of the numbers, and the largest files of each set over budget. */
export function report(measured, budget, sizes) {
  const over = overBudget(measured, budget);
  const lines = [
    '| | gzip | budget | headroom |',
    '| --- | ---: | ---: | ---: |',
    ...METRICS.map((metric) => {
      const { bytes } = measured[metric];
      const left = budget[metric] - bytes;
      const mark = over.includes(metric) ? ' **over**' : '';
      return `| ${LABELS[metric]}${metric === 'largestChunk' ? ` (\`${shortName(measured.largestChunk.files[0] ?? '-')}\`)` : ''} | ${kb(bytes)} | ${kb(budget[metric])} | ${left < 0 ? '-' : ''}${kb(Math.abs(left))}${mark} |`;
    }),
  ];
  for (const metric of over) {
    lines.push('', `**${LABELS[metric]}** is over budget; its largest files:`, '');
    for (const file of measured[metric].files.slice(0, 8)) lines.push(`- \`${shortName(file)}\` ${kb(sizes[file])}`);
  }
  return lines.join('\n');
}

async function gzipSizes(nextDir) {
  const entries = await readdir(path.join(nextDir, 'static'), { withFileTypes: true, recursive: true });
  const sizes = {};
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(js|css)$/.test(entry.name)) continue;
    const file = path.join(entry.parentPath, entry.name);
    const key = path.relative(nextDir, file).split(path.sep).join('/');
    sizes[key] = gzipSync(await readFile(file), { level: 9 }).length;
  }
  return sizes;
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((arg) => arg.startsWith('--')));
  const [outArg, distArg] = args.filter((arg) => !arg.startsWith('--'));
  const outDir = path.resolve(outArg ?? 'out');
  const distDir = path.resolve(distArg ?? '.next');
  const budgetFile = fileURLToPath(new URL('./bundle-budget.json', import.meta.url));

  const manifest = JSON.parse(await readFile(path.join(distDir, 'react-loadable-manifest.json'), 'utf8'));
  const html = await readFile(path.join(outDir, 'index.html'), 'utf8');
  const firstLoad = [...new Set([...pageScripts(html), ...pageChunks(manifest)])];
  if (firstLoad.length === 0) throw new Error('No first-load chunks found in out/index.html');
  const sizes = await gzipSizes(path.join(outDir, '_next'));
  const measured = measure(sizes, firstLoad);
  const config = JSON.parse(await readFile(budgetFile, 'utf8'));

  if (flags.has('--update')) {
    const next = { ...config, budget: budgetFor(measured, config.headroom) };
    await writeFile(budgetFile, `${JSON.stringify(next, null, 2)}\n`);
    process.stdout.write(`Bundle budget: rewrote ${path.relative(process.cwd(), budgetFile)}\n`);
    config.budget = next.budget;
  }

  const table = report(measured, config.budget, sizes);
  process.stdout.write(`Bundle size (${firstLoad.length} first-load files)\n\n${table}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Bundle size\n\n${table}\n`);
  }

  const outcome = verdict(overBudget(measured, config.budget), flags.has('--report-only'));
  if (outcome === null) return;
  process.stderr.write(`${outcome.annotation}\n`);
  process.exitCode = outcome.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
