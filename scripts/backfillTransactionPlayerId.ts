/**
 * Backfill Transaction.playerId for rows written before the column existed.
 *
 * The link is recovered from the headline, which is the only place a player's
 * identity was ever recorded. That is exactly why the column now exists: this
 * script is a one-off rescue of history, not a pattern to repeat. Every new
 * row sets playerId at write time.
 *
 * Two rules keep it honest:
 *   1. A name is matched only WITHIN THE SAME LEAGUE, and only when it
 *      resolves to exactly one player. Two men sharing a name leave the row
 *      null rather than guessing — null means "not known", which is true.
 *   2. Row types that are not about a single player (CHAMPION, TRADE, NEWS,
 *      FIRE) are never touched.
 *
 * Idempotent: only rows with playerId IS NULL are considered.
 */
import { prisma } from '../lib/db';

/** Every type whose headline names exactly one player. */
const PLAYER_TYPES = [
  // INJURY is deliberately absent: those rows are game-level ("5 injury
  // report(s) from NOR @ TAM") and name several men or none. A column that
  // means "the man this row is about" has no honest value for them.
  'SIGN', 'CUT', 'RESIGN', 'TAG', 'DRAFT', 'DEV_MILESTONE',
  'ALL_STAR', 'ALL_STAR_SNUB',
  'AWARD_MVP', 'AWARD_OPOY', 'AWARD_DPOY', 'AWARD_ROTY', 'AWARD_SBMVP',
];

/**
 * The name inside a headline, for each shape the codebase writes.
 *   "Kyler Ironside (QB)"                        -> awards, all-stars
 *   "Signed Maddox Saffold"                      -> SIGN
 *   "Released Maddox Saffold"                    -> CUT
 *   "Round 7, Pick 32: Lorenzo Doyle (WR)"       -> DRAFT
 *   "Fantasy draft: Lorenzo Doyle (WR)"          -> DRAFT
 *   "Rhett Buckhalter is pacing the league in …" -> DEV_MILESTONE
 */
function nameFrom(headline: string): string | null {
  let h = headline.trim();
  h = h.replace(/^Round \d+, Pick \d+:\s*/, '').replace(/^Fantasy draft:\s*/, '');
  h = h.replace(/^(Signed|Released|Re-signed|Tagged|Extended|Franchise[- ]tagged)\s+/i, '');
  const paren = h.match(/^(.+?)\s*\([A-Z]{1,5}\)/);
  if (paren) return paren[1].trim();
  const pacing = h.match(/^(.+?)\s+is pacing the league/);
  if (pacing) return pacing[1].trim();
  // "Solomon Lindstrom franchise-tagged" — the one suffix form.
  const tagged = h.match(/^(.+?)\s+franchise-tagged$/i);
  if (tagged) return tagged[1].trim();
  // "<League name> founded" is a SIGN row about no player at all.
  if (/\bfounded$/i.test(h)) return null;
  // A bare "Firstname Lastname" and nothing else.
  if (/^[^,.:;()]+$/.test(h) && h.split(/\s+/).length >= 2 && h.split(/\s+/).length <= 4) return h;
  return null;
}

(async () => {
  const dryRun = process.argv.includes('--dry-run');
  const leagues = await prisma.league.findMany({ select: { id: true, name: true } });
  let considered = 0, matched = 0, ambiguous = 0, unparsed = 0, notFound = 0;

  for (const l of leagues) {
    const rows = await prisma.transaction.findMany({
      where: { leagueId: l.id, playerId: null, type: { in: PLAYER_TYPES } },
      select: { id: true, headline: true },
    });
    if (rows.length === 0) continue;

    const players = await prisma.player.findMany({
      where: { leagueId: l.id },
      select: { id: true, firstName: true, lastName: true },
    });
    const byName = new Map<string, string[]>();
    for (const p of players) {
      const k = `${p.firstName} ${p.lastName}`.toLowerCase();
      (byName.get(k) ?? byName.set(k, []).get(k)!).push(p.id);
    }

    const updates: [string, string][] = [];
    for (const r of rows) {
      considered++;
      const name = nameFrom(r.headline);
      if (!name) { unparsed++; continue; }
      const hits = byName.get(name.toLowerCase());
      if (!hits) { notFound++; continue; }
      if (hits.length > 1) { ambiguous++; continue; }
      updates.push([r.id, hits[0]]);
    }
    matched += updates.length;
    if (!dryRun) {
      // updateMany, not update: other processes write to this database while
      // this runs (recordAllStars deletes and re-creates its rows every time a
      // season is re-simmed), so a row read a moment ago may already be gone.
      // updateMany treats "no longer there" as zero rows, which is the truth;
      // update throws P2025 and takes the whole batch down with it.
      const byPlayer = new Map<string, string[]>();
      for (const [id, playerId] of updates) (byPlayer.get(playerId) ?? byPlayer.set(playerId, []).get(playerId)!).push(id);
      for (const [playerId, ids] of byPlayer) {
        for (let i = 0; i < ids.length; i += 500) {
          await prisma.transaction.updateMany({
            where: { id: { in: ids.slice(i, i + 500) }, playerId: null },
            data: { playerId },
          });
        }
      }
    }
  }

  const pct = considered ? ((100 * matched) / considered).toFixed(1) : '0.0';
  console.log(`${dryRun ? '[dry run] ' : ''}considered ${considered}  matched ${matched} (${pct}%)`);
  console.log(`  unparsed headline ${unparsed}  name not on any roster ${notFound}  ambiguous (two men, left null) ${ambiguous}`);
  await prisma.$disconnect();
})();
