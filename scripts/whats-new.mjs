// Build time: the "What's new" card's lines, read from CHANGELOG.md (#931).
// next.config.mjs stamps the result into the bundle as an environment
// string, read only by a chunk loaded when the card opens, so the page never
// fetches anything to show it and the copy is never kept by hand.

/** Lines on the card: the issue's "trimmed to five per release". */
export const MAX_ITEMS = 5;
/** A line longer than this is cut at a word and ends in an ellipsis. */
export const MAX_LINE = 110;

const VERSION = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;

/** "1.38.0" as numbers; null for anything else. */
function parse(version) {
  const match = VERSION.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function older(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * One changelog bullet as a short line of plain text: links keep their
 * text; asides in brackets (issue numbers among them) and code and bold
 * marks go. A long line is cut at a word and says so with an ellipsis,
 * never at a clause, which could change what it means.
 */
export function shortLine(bullet) {
  const text = bullet
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s*\([^()]*\)/g, '')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= MAX_LINE) return text;
  const word = text.lastIndexOf(' ', MAX_LINE - 1);
  return `${text.slice(0, word > 0 ? word : MAX_LINE - 1).replace(/[\s,:;.–-]+$/, '')}…`;
}

/** A bullet's bold lead ("**Walkers sit down:** …"), the area it belongs to; null without one. */
function boldLead(bullet) {
  const match = /^\*\*([^*]+)\*\*/.exec(bullet);
  return match ? match[1].replace(/[:.]\s*$/, '').trim() : null;
}

/**
 * Up to `MAX_ITEMS` bullets spread across the section, in file order: a
 * release that ships two milestones lists one after the other, so the
 * first five would all be the first one's. Bullets under the same bold
 * lead count as one area, which offers its first bullet.
 */
export function pickBullets(bullets) {
  const seen = new Set();
  const areas = [];
  for (const bullet of bullets) {
    const lead = boldLead(bullet);
    if (lead !== null) {
      if (seen.has(lead)) continue;
      seen.add(lead);
    }
    areas.push(bullet);
  }
  if (areas.length <= MAX_ITEMS) return areas;
  return Array.from({ length: MAX_ITEMS }, (_, i) => areas[Math.floor((i * areas.length) / MAX_ITEMS)]);
}

/**
 * The newest released section at or below `version` that has Added lines
 * (under "### Added", whatever follows it on the heading): its version and
 * up to five lines picked across it, shortened. A patch release with only
 * fixes keeps the release before it on the card. Null when there is none,
 * as for a missing changelog.
 */
export function whatsNewFor(changelog, version) {
  const current = parse(version);
  if (!current || typeof changelog !== 'string') return null;
  let inAdded = false;
  let found = null;
  for (const raw of changelog.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = /^## \[([^\]]+)\]/.exec(line);
    if (heading) {
      if (found && found.bullets.length > 0) break;
      const v = parse(heading[1]);
      found = v && older(v, current) <= 0 ? { version: heading[1], bullets: [] } : null;
      inAdded = false;
      continue;
    }
    if (!found) continue;
    if (/^### /.test(line)) {
      inAdded = /^### Added\b/.test(line);
      continue;
    }
    const bullet = inAdded ? /^- (.+)$/.exec(line) : null;
    if (bullet?.[1]) found.bullets.push(bullet[1]);
  }
  if (!found || found.bullets.length === 0) return null;
  const items = pickBullets(found.bullets).map(shortLine).filter((item) => item !== '');
  return items.length > 0 ? { version: found.version, items } : null;
}

/** `whatsNewFor` over a file that may be missing: no changelog, no card, never a failed build. */
export function whatsNewFromFile(readText, version) {
  let changelog;
  try {
    changelog = readText();
  } catch {
    return null;
  }
  return whatsNewFor(changelog, version);
}
