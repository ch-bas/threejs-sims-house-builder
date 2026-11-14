/**
 * Run `run` and measure the CPU time this process spent on it, in
 * milliseconds (user + system, from `process.cpuUsage()`). Unlike a wall
 * clock it barely grows while the machine is busy, so a bound on it checks
 * the work done, not the load (#733). Vitest's default forks pool gives each
 * test file its own process; under the threads pool, other files' work in
 * the same process would count too.
 */
export function measureCpu<T>(run: () => T): { result: T; cpuMs: number } {
  const before = process.cpuUsage();
  const result = run();
  const spent = process.cpuUsage(before);
  return { result, cpuMs: (spent.user + spent.system) / 1000 };
}

/**
 * `measureCpu` for async work. The whole process is measured, so work done
 * meanwhile on libuv's pool (zlib streams) counts too, as it should.
 */
export async function measureCpuAsync<T>(run: () => Promise<T>): Promise<{ result: T; cpuMs: number }> {
  const before = process.cpuUsage();
  const result = await run();
  const spent = process.cpuUsage(before);
  return { result, cpuMs: (spent.user + spent.system) / 1000 };
}
