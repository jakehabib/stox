/**
 * ===========================================================================
 * AWARD TRANSACTION TYPES — ONE LIST, EVERY READER
 * ===========================================================================
 * A season award is stored as a Transaction row whose `type` names the
 * trophy (see the Transaction model in prisma/schema.prisma). Nine or ten
 * different surfaces have to agree on that vocabulary: the writer in
 * lib/season.ts, the seeded backstory in lib/gen/leagueHistory.ts, the XP
 * model, the dynasty leaderboard, the GM career page, the league wire and
 * its ranking, the history table and the player card.
 *
 * They used to agree by copy-paste — two separate `AWARD_TYPES` arrays and
 * four separate `AWARD_LABEL` maps spelling out the same five strings. That
 * is exactly how a new trophy ends up counted on one screen and invisible on
 * the next, which turns "awards won" into a number that disagrees with the
 * trophy case sitting next to it. So the vocabulary lives here, once, in a
 * module that imports nothing (no cycle is possible with a leaf), and every
 * reader imports it.
 *
 * RETIRED-BUT-HONOURED TYPES. `AWARD_ROTY` — a single, undivided Rookie of
 * the Year — is no longer written by anything. Real football hands out two
 * rookie awards, one per side of the ball, so the live season now writes
 * `AWARD_OROTY` and `AWARD_DROTY` instead. But thousands of `AWARD_ROTY`
 * rows are already sitting in saves that were played before the split, and a
 * man who won it in 2031 still won it. So the type stays in `AWARD_TYPES`
 * and in `AWARD_LABEL` forever: it is READ everywhere and WRITTEN nowhere.
 * Anything that iterates these lists to count or render history must keep
 * including it; only lib/season.ts's writer and lib/gen/leagueHistory.ts's
 * generator are allowed to leave it out, and both say so where they do.
 * ===========================================================================
 */

/**
 * Every award type that can appear in the transaction feed, retired ones
 * included, in the order they should be listed when a screen shows all of
 * them. Anything counting a player's or a GM's trophies reads THIS list, so
 * that a count and the cabinet under it can never disagree.
 */
export const AWARD_TYPES: string[] = [
  'AWARD_MVP',
  'AWARD_OPOY',
  'AWARD_DPOY',
  'AWARD_OROTY',
  'AWARD_DROTY',
  // Retired: pre-split Rookie of the Year. Read-only — see the file header.
  'AWARD_ROTY',
  'AWARD_SBMVP',
];

/**
 * The award types a newly completed season actually hands out. The live
 * writer (lib/season.ts) and the seeded backstory (lib/gen/leagueHistory.ts)
 * both produce exactly these; `AWARD_TYPES` minus the retired ones.
 */
export const AWARDED_TYPES: string[] = AWARD_TYPES.filter((t) => t !== 'AWARD_ROTY');

/**
 * How a trophy is spelled anywhere there is room for its real name — the
 * player card, the trophy case, the history table, the GM career page.
 * Full names, not initialisms: this is player-facing text about the proudest
 * line on a man's record, and "OROTY" is a database key, not an honour.
 */
export const AWARD_LABEL: Record<string, string> = {
  AWARD_MVP: 'MVP',
  AWARD_OPOY: 'Offensive Player of the Year',
  AWARD_DPOY: 'Defensive Player of the Year',
  AWARD_OROTY: 'Offensive Rookie of the Year',
  AWARD_DROTY: 'Defensive Rookie of the Year',
  // Retired but honoured: rows written before the rookie award was split in
  // two must keep reading as the award their winner actually won.
  AWARD_ROTY: 'Rookie of the Year',
  AWARD_SBMVP: 'Championship MVP',
};

/**
 * The short form, for the places a full name will not fit — the league wire's
 * filter chips and its type badges. Everywhere with room uses AWARD_LABEL.
 */
export const AWARD_CODE: Record<string, string> = {
  AWARD_MVP: 'MVP',
  AWARD_OPOY: 'OPOY',
  AWARD_DPOY: 'DPOY',
  AWARD_OROTY: 'OROTY',
  AWARD_DROTY: 'DROTY',
  AWARD_ROTY: 'ROTY',
  AWARD_SBMVP: 'SB MVP',
};

/** True for any transaction type that is a season award, retired ones included. */
export function isAwardType(type: string): boolean {
  return AWARD_TYPES.includes(type);
}
