import { exportFileName } from './plan-export/download';
import type { RoomLayout } from './types';

/** The media type AR Quick Look opens. */
export const USDZ_MIME = 'model/vnd.usdz+zip';

/**
 * Whether this browser opens `<a rel="ar">` in AR Quick Look (#937): iOS and
 * iPadOS Safari, and the apps that use its web view. Everywhere else the
 * house is offered as a USDZ download instead.
 */
export function quickLookSupported(doc: Pick<Document, 'createElement'> | undefined = globalThis.document): boolean {
  if (!doc) return false;
  try {
    const relList = doc.createElement('a').relList as DOMTokenList | undefined;
    return relList?.supports?.('ar') === true;
  } catch {
    return false;
  }
}

/** The file the USDZ export saves as: the house's name, like the GLB. */
export function usdzFileName(layout: Pick<RoomLayout, 'name'>): string {
  return exportFileName(layout.name, 'usdz');
}

/**
 * The house at table size (1:50) as a USDZ file. The exporter and the
 * engine load here, on the click (#589): neither is in the editor's first load.
 */
export async function buildUsdzBlob(layout: RoomLayout): Promise<Blob> {
  const [THREE, { layoutToUsdz }] = await Promise.all([import('../three/three-runtime'), import('../three/usdz-export')]);
  return new Blob([await layoutToUsdz(THREE, layout)], { type: USDZ_MIME });
}

/**
 * The picture inside the "Open in AR" link. Safari hands a `rel="ar"` link
 * to Quick Look only when its first child is an image, and Quick Look zooms
 * out of that image's rectangle. A small cube, inline (the CSP allows data:).
 */
export const AR_LINK_IMAGE =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#5eead4" stroke-width="2" stroke-linejoin="round"><path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/></svg>'
  );
