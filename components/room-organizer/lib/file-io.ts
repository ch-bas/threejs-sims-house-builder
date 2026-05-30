import { parseStoredLayout } from './schema';
import type { RoomLayout } from './types';

export function downloadLayoutAsJson(layout: RoomLayout): void {
  const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = `${layout.name.replace(/\s+/g, '_')}.json`;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
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

export async function readImageAsDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please upload an image file (PNG, JPG, etc.)');
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'));
    reader.readAsDataURL(file);
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
    URL.revokeObjectURL(url);
  }
}

function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export async function downloadSceneAsGlb(scene: import('three').Object3D, baseName: string): Promise<void> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const exporter = new GLTFExporter();
  await new Promise<void>((resolve, reject) => {
    exporter.parse(
      scene,
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
          URL.revokeObjectURL(url);
        }
        resolve();
      },
      (error) => reject(error instanceof Error ? error : new Error('GLB export failed.')),
      { binary: true }
    );
  });
}

export function downloadCanvasAsPng(canvas: HTMLCanvasElement, baseName: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = `${baseName.replace(/\s+/g, '_')}.png`;
      link.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  }, 'image/png');
}
