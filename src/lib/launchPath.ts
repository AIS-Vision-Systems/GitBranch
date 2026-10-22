/** Open every queued launch path until the backend reports none left. Returns how many were opened. */
export async function drainLaunchPaths(
  take: () => Promise<string | null>,
  open: (path: string) => Promise<unknown>,
): Promise<number> {
  let n = 0;
  for (;;) {
    const path = await take();
    if (path === null) return n;
    n += 1;
    await open(path);
  }
}
