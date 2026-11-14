export type Metric = 'firstLoadJs' | 'largestChunk' | 'css';

export const METRICS: readonly Metric[];

export type Measured = Record<Metric, { bytes: number; files: string[] }>;

export function pageScripts(html: string): string[];

export function measure(sizes: Record<string, number>, firstLoadFiles: readonly string[]): Measured;

export function overBudget(measured: Measured, budget: Record<Metric, number>): Metric[];

export function budgetFor(measured: Measured, headroom: number): Record<Metric, number>;

export function verdict(over: readonly Metric[], reportOnly: boolean): { annotation: string; exitCode: number } | null;

export function report(measured: Measured, budget: Record<Metric, number>, sizes: Record<string, number>): string;
