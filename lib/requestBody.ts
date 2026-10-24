import { NextRequest } from 'next/server';

/**
 * Reads a request body as text, giving up the moment it exceeds `max`.
 * Returns null rather than throwing, because "too big" is an answer, not a
 * fault, and the caller wants to answer 413 rather than 500.
 *
 * THE COUNTING IS ON THE RAW BYTES AS THEY ARRIVE, so nothing larger than the
 * cap is ever held in memory — a 50MB upload is abandoned after the first few
 * megabytes and the connection is cancelled. That is the only version of
 * "refuse cheaply" that is actually cheap: `req.formData()` and `req.text()`
 * both buffer the whole upload before they return, so a size limit applied
 * after either of them is a limit on what is already in memory.
 *
 * A Content-Length check still belongs IN FRONT of this on every route that
 * uses it. A header is a claim and the body is the fact; the claim is free to
 * refuse and the fact costs a connection.
 *
 * ONE COPY, TWO ROUTES. /api/league/import takes a league file this way and
 * /api/league/validate takes the same file to check it without writing. They
 * have to apply the same cap in the same place, so they read the same bytes
 * through the same function rather than each carrying its own loop — two byte
 * counters drift, and the one that drifts low is the one that stops being a
 * limit.
 */
export async function readCappedBody(req: NextRequest, max: number): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return '';

  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } catch {
    // A dropped or malformed upload reads as an empty file, which the parser
    // already has a clear message for.
    return '';
  }
  return Buffer.concat(chunks).toString('utf8');
}
