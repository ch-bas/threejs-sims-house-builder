import { parseStoredLayout } from './schema';
import type { RoomLayout } from './types';

export function downloadLayoutAsJson(layout: RoomLayout): void {
  const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    // Guard the empty-name case (mirrors the CSV path) so we never produce a
    // bare `.json` filename.
    link.download = `${(layout.name || 'layout').replace(/\s+/g, '_')}.json`;
    link.click();
  } finally {
    // Defer the revoke: revoking synchronously right after click() can cancel
    // the download mid-flight in some browsers. A 0ms timeout releases the URL
    // after the click has been dispatched.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export async function readLayoutFromFile(file: File): Promise<RoomLayout> {
  const text = await file.text();
  const parsed: unknown = JSON.parse(text);
  const layout = parseStoredLayout(parsed);
  if (!layout) {
    throw new Error('Invalid layout file: structure does not match the expected schema.');
  }
  return layout;
}

/** Longest-edge cap for a stored floor plan, in pixels. */
const MAX_IMAGE_EDGE = 1500;

export async function readImageAsDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please upload an image file (PNG, JPG, etc.)');
  }
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });

  // A full-resolution floor plan can easily be several MB of base64, which
  // exhausts the ~5MB localStorage budget and makes every save fail. Downscale
  // anything larger than MAX_IMAGE_EDGE on its long edge and re-encode as JPEG
  // so the stored layout stays well within budget.
  return downscaleDataUrl(rawDataUrl);
}

function downscaleDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const longEdge = Math.max(image.width, image.height);
      if (longEdge <= MAX_IMAGE_EDGE || longEdge === 0) {
        resolve(dataUrl);
        return;
      }
      const scale = MAX_IMAGE_EDGE / longEdge;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    // On decode failure, fall back to the original data URL rather than losing
    // the upload entirely.
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

export function downloadInventoryCsv(layout: RoomLayout): void {
  const lines = ['Floor,Category,Type,Name,Width (m),Depth (m),Height (m),Color,Price'];
  for (const floor of layout.floors) {
    for (const item of floor.items) {
      const fields: string[] = [
        floor.name,
        item.category ?? '',
        item.type,
        item.name,
        item.width.toFixed(2),
        item.depth.toFixed(2),
        item.height.toFixed(2),
        item.color,
        (item.price ?? 0).toString(),
      ];
      lines.push(fields.map(csvField).join(','));
    }
  }
  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(layout.name || 'inventory').replace(/\s+/g, '_')}_inventory.csv`;
    link.click();
  } finally {
    // Defer the revoke so it can't truncate the download (see downloadLayoutAsJson).
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function csvField(value: string): string {
  // Neutralize spreadsheet formula injection: a value beginning with =, +, -,
  // @, or a tab is interpreted as a formula by Excel/Sheets, so an imported
  // layout with an item named `=HYPERLINK(...)` would execute on export.
  // Prefix a single quote to force it to a literal string.
  const safe = /^[=+\-@\t]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

/**
 * userData.type tags that make up the "meaningful" model the user expects in an
 * exported .glb: the furniture and the room shell (walls incl. the floor grid
 * helper + baseboards, interior walls, floor incl. the foundation, and the
 * roof). Everything else — lights (`light:*`), the sky, the ground/outdoor
 * scenery, NPCs, Wi-Fi/vision overlays, measurement markers, and item labels —
 * is deliberately excluded.
 */
const GLB_EXPORT_TAGS: ReadonlySet<string> = new Set([
  'furniture',
  'floor',
  'wall',
  'interior-wall',
  'roof',
]);

/**
 * Build a throwaway group holding CLONES of just the meaningful scene objects.
 * Cloning (rather than reparenting) keeps the live scene untouched and lets us
 * discard the group without disposing the shared geometries/materials the
 * clones borrow by reference. Transforms are preserved by clone().
 */
function collectExportGroup(THREE: typeof import('three'), scene: import('three').Object3D): import('three').Group {
  const group = new THREE.Group();
  for (const child of scene.children) {
    const tag = child.userData.type as string | undefined;
    if (tag !== undefined && GLB_EXPORT_TAGS.has(tag)) {
      group.add(child.clone());
    }
  }
  return group;
}

export async function downloadSceneAsGlb(scene: import('three').Object3D, baseName: string): Promise<void> {
  const THREE = await import('three');
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const exporter = new GLTFExporter();
  // Export a temporary group of cloned meshes so the .glb carries only the
  // furniture + room shell — not lights, sky, NPCs, overlays, or markers.
  const exportGroup = collectExportGroup(THREE, scene);
  try {
    await new Promise<void>((resolve, reject) => {
      exporter.parse(
        exportGroup,
        (result) => {
          const blob =
            result instanceof ArrayBuffer
              ? new Blob([result], { type: 'model/gltf-binary' })
              : new Blob([JSON.stringify(result)], { type: 'application/json' });
          const extension = result instanceof ArrayBuffer ? 'glb' : 'gltf';
          const url = URL.createObjectURL(blob);
          try {
            const link = document.createElement('a');
            link.href = url;
            link.download = `${baseName.replace(/\s+/g, '_')}.${extension}`;
            link.click();
          } finally {
            // Defer the revoke so it can't truncate the download (see downloadLayoutAsJson).
            setTimeout(() => URL.revokeObjectURL(url), 0);
          }
          resolve();
        },
        (error) => reject(error instanceof Error ? error : new Error('GLB export failed.')),
        { binary: true }
      );
    });
  } finally {
    // Discard the temp group. The clones borrow the live scene's geometries and
    // materials by reference, so only detach them (clear) — never dispose, or
    // we'd destroy resources the on-screen scene is still using.
    exportGroup.clear();
  }
}

/**
 * Trigger a PNG download of the canvas. Resolves to `true` on success and
 * `false` when `toBlob` yields null (e.g. a tainted canvas or an out-of-memory
 * encode) so the caller can surface a failure instead of a silent no-op.
 */
export function downloadCanvasAsPng(canvas: HTMLCanvasElement, baseName: string): Promise<boolean> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(false);
        return;
      }
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = `${(baseName || 'screenshot').replace(/\s+/g, '_')}.png`;
        link.click();
      } finally {
        // Defer the revoke so it can't truncate the download (see downloadLayoutAsJson).
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      resolve(true);
    }, 'image/png');
  });
}
