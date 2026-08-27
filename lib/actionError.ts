/**
 * ===========================================================================
 * WHAT A FAILED SERVER ACTION IS ALLOWED TO SAY
 * ===========================================================================
 * Most of the mutating actions in app/actions/** end in the same shape:
 *
 *     catch (err) { return { ok: false, message: err.message } }
 *
 * That is right for the errors the game throws on purpose — "The tag is for a
 * man whose deal is up", "They aren't interested in that offer" — which are
 * written to be read by a GM and are the whole reason those actions return a
 * result instead of throwing.
 *
 * It is wrong for everything else. A Prisma failure's `message` is a rendered
 * query, a `→` marker, an absolute path into the developer's home directory
 * and a line number, and it went straight onto the confirmation panel. Two
 * measured examples, both from an ordinary double click:
 *
 *   Release, twice:      Invalid `tx.contract.delete()` invocation in
 *                        /home/…/lib/freeagency.ts:1522 … Record to delete
 *                        does not exist.
 *   Restructure of NaN:  Argument `signingBonus` is missing. … guaranteed: NaN
 *
 * Neither tells the player anything they can act on, both break the fiction,
 * and the second prints part of the schema. So: a deliberate error keeps its
 * own words, and a database-level one is answered by the caller's fallback
 * sentence, which is written for the move that failed and can name it.
 *
 * Detected by NAME rather than by `instanceof`, because the Prisma error
 * classes live behind the generated client and importing them here would drag
 * the runtime into every module that wants to word a refusal.
 * ===========================================================================
 */
export function actionFailureMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  if (err.name.startsWith('Prisma')) return fallback;
  // A thrown string, or an Error with nothing in it, is not a sentence either.
  return err.message.trim().length > 0 ? err.message : fallback;
}
