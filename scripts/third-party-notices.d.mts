export declare const SHIPPED_DEV_PACKAGES: readonly string[];

export declare const NEXT_COMPILED_PACKAGES: readonly string[];

export declare const NEXT_POLYFILLS: ReadonlyArray<{ name: string; version: string; license: string; file: string }>;

export interface LockEntry {
  version?: string;
  license?: string;
  dev?: boolean;
  devOptional?: boolean;
  optional?: boolean;
}

export interface ShippedPackage {
  name: string;
  version: string;
  license: string;
  dir: string;
}

export interface NoticeEntry {
  name: string;
  version: string;
  license: string;
  text: string | null;
  source?: string | null;
}

export function shippedPackages(lock: { packages?: Record<string, LockEntry> }): ShippedPackage[];

export function noticesText(
  packages: readonly NoticeEntry[],
  bundled: readonly NoticeEntry[],
  assets: ReadonlyArray<{ name: string; license: string; text: string }>,
): string;

export function writeNotices(
  root: string,
  outDir: string,
): Promise<{ file: string; packages: number; bundled: number; missing: string[] }>;
