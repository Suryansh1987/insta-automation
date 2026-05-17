export function randomDelayMs(minMs: number, maxMs: number): number {
  if (minMs === maxMs) return minMs;
  const delta = maxMs - minMs + 1;
  return Math.floor(Math.random() * delta) + minMs;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
