/**
 * Bounded-concurrency map with settle-all semantics.
 *
 * Runs `fn` over `items` with at most `limit` invocations in flight at once,
 * using a fixed pool of workers that pull from a shared cursor. Unlike
 * `Promise.all(items.map(fn))`, ONE rejection does not abort the rest: every
 * item is attempted and its outcome captured. The returned array is
 * index-aligned with `items` — each entry is either `{ ok: true, value }` or
 * `{ ok: false, error }`.
 *
 * No external deps (no p-limit / p-queue): a simple worker pool over a shared
 * index is all that's needed and keeps us within the no-new-dependency
 * constraint.
 */
export type Settled<R> =
  | { ok: true; value: R }
  | { ok: false; error: unknown }

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Settled<R>[]> {
  const results = new Array<Settled<R>>(items.length)
  if (items.length === 0) return results

  const workers = Math.max(1, Math.min(limit, items.length))
  let cursor = 0

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      try {
        const value = await fn(items[index], index)
        results[index] = { ok: true, value }
      } catch (error) {
        results[index] = { ok: false, error }
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}
