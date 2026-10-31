import { COARSE_POINTER_QUERY } from './hud-layout';
import { isShareUrlReasonablySized, type EncodeShareUrlResult } from './share';

/**
 * Getting a share link off the page (#685). Encoding is asynchronous, and
 * Safari only allows the clipboard inside the tap that asked for it, so a
 * write after the `await` always fails there. On a touch screen the share
 * sheet comes first; otherwise the clipboard is handed a promise of the text,
 * in the tap, which Safari accepts. The copy-by-hand field is the last resort.
 */

export interface ShareChannels {
  /** The share sheet: touch screens that have one. */
  share?(url: string): Promise<void>;
  /** A clipboard write that starts now, before the text is ready. */
  writeLater?(text: Promise<string>): Promise<void>;
  writeText?(text: string): Promise<void>;
}

export type ShareOutcome =
  | { kind: 'shared' | 'copied'; strippedFloorPlan: boolean }
  /** The user closed the share sheet: nothing to say. */
  | { kind: 'cancelled' }
  | { kind: 'too-large' }
  /** Copy by hand. `share` is set when a fresh tap may open the sheet. */
  | { kind: 'manual'; url: string; share?: () => Promise<void> };

/** The user dismissing the share sheet, as opposed to it failing. */
export function isShareCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function attempt(write: (() => Promise<void>) | undefined): Promise<boolean> {
  if (!write) return false;
  try {
    await write();
    return true;
  } catch {
    return false;
  }
}

/**
 * Delivers the link. Call it directly from the click, with `encoded` not yet
 * awaited: everything up to its first `await` runs inside the user's tap.
 */
export async function deliverShareLink(encoded: Promise<EncodeShareUrlResult>, channels: ShareChannels): Promise<ShareOutcome> {
  const { share, writeLater, writeText } = channels;

  if (share) {
    const { url, strippedFloorPlan } = await encoded;
    if (!isShareUrlReasonablySized(url)) return { kind: 'too-large' };
    try {
      await share(url);
      return { kind: 'shared', strippedFloorPlan };
    } catch (error) {
      if (isShareCancelled(error)) return { kind: 'cancelled' };
    }
    // The wait for the encoding can outlast the tap's permission, here for
    // the sheet and the clipboard alike; the next tap can have the sheet.
    if (await attempt(writeText && (() => writeText(url)))) return { kind: 'copied', strippedFloorPlan };
    return { kind: 'manual', url, share: () => share(url) };
  }

  const sized = async (): Promise<string> => {
    const { url } = await encoded;
    if (!isShareUrlReasonablySized(url)) throw new Error('Too large to share');
    return url;
  };
  // Started now, in the tap; a failure surfaces below.
  const written = attempt(writeLater && (() => writeLater(sized())));
  const { url, strippedFloorPlan } = await encoded;
  if (!isShareUrlReasonablySized(url)) return { kind: 'too-large' };
  if ((await written) || (await attempt(writeText && (() => writeText(url))))) return { kind: 'copied', strippedFloorPlan };
  return { kind: 'manual', url };
}

/** The real thing: `navigator`'s channels, where the browser has them. */
export function browserShareChannels(): ShareChannels {
  const { clipboard } = navigator;
  const touch = typeof window.matchMedia === 'function' && window.matchMedia(COARSE_POINTER_QUERY).matches;
  // Looked up as members: older browsers lack some of what the types promise.
  const canShare = touch && typeof navigator.share === 'function';
  const canWriteLater = typeof clipboard?.write === 'function' && typeof ClipboardItem === 'function';
  const canWriteText = typeof clipboard?.writeText === 'function';
  return {
    ...(canShare ? { share: (url: string) => navigator.share({ url }) } : {}),
    ...(canWriteLater
      ? {
          writeLater(text: Promise<string>) {
            const blob = text.then((value) => new Blob([value], { type: 'text/plain' }));
            return clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
          },
        }
      : {}),
    ...(canWriteText ? { writeText: (text: string) => clipboard.writeText(text) } : {}),
  };
}
