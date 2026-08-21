import { BoxScore, BoxLine } from './types';
import { RivalryProfile, rivalryHeadlineFragment } from './rivalry';

/**
 * League news generation from things the sim already computed. Nothing here
 * simulates anything new — it just decides which existing results are
 * newsworthy and phrases them, per the brief's point that this is "mostly
 * turning events your simulation already generates into readable content."
 */

export interface NewsItem {
  headline: string;
  detail: string;
  teamId?: string;
}

/** [TUNE] Minimum stat lines to be considered a "headline" performance. */
const THRESHOLDS = {
  passYds: 350, passTd: 4,
  rushYds: 150, rushTd: 3,
  recYds: 150, recTd: 3,
  sacks: 3, defInt: 2, fgm: 4,
};

function isNotable(l: BoxLine): boolean {
  const s = l.stats;
  return (
    (s.passYds ?? 0) >= THRESHOLDS.passYds || (s.passTd ?? 0) >= THRESHOLDS.passTd ||
    (s.rushYds ?? 0) >= THRESHOLDS.rushYds || (s.rushTd ?? 0) >= THRESHOLDS.rushTd ||
    (s.recYds ?? 0) >= THRESHOLDS.recYds || (s.recTd ?? 0) >= THRESHOLDS.recTd ||
    (s.sacks ?? 0) >= THRESHOLDS.sacks || (s.defInt ?? 0) >= THRESHOLDS.defInt || (s.fgm ?? 0) >= THRESHOLDS.fgm
  );
}

function describe(l: BoxLine): string {
  const s = l.stats;
  if ((s.passYds ?? 0) >= THRESHOLDS.passYds || (s.passTd ?? 0) >= THRESHOLDS.passTd) return `throws for ${s.passYds} yards and ${s.passTd} TD`;
  if ((s.rushYds ?? 0) >= THRESHOLDS.rushYds || (s.rushTd ?? 0) >= THRESHOLDS.rushTd) return `runs for ${s.rushYds} yards and ${s.rushTd} TD`;
  if ((s.recYds ?? 0) >= THRESHOLDS.recYds || (s.recTd ?? 0) >= THRESHOLDS.recTd) return `catches for ${s.recYds} yards and ${s.recTd} TD`;
  if ((s.sacks ?? 0) >= THRESHOLDS.sacks) return `records ${s.sacks} sacks`;
  if ((s.defInt ?? 0) >= THRESHOLDS.defInt) return `hauls in ${s.defInt} interceptions`;
  if ((s.fgm ?? 0) >= THRESHOLDS.fgm) return `hits ${s.fgm} field goals`;
  return 'has a big game';
}

/**
 * Up to 2 headline performances from one game's box score, most notable
 * first. `rivalry`, if passed, MUST be the pre-game head-to-head state (see
 * lib/rivalry.ts's rivalryRecapLine) — optional and defaulted so every
 * existing caller keeps compiling unchanged until it's wired up.
 */
export function gameHeadlines(box: BoxScore, homeTeamId: string, awayTeamId: string, rivalry?: RivalryProfile | null): NewsItem[] {
  const lines = [
    ...box.lines.home.map((l) => ({ l, teamId: homeTeamId, teamAbbr: box.homeTeam.abbr })),
    ...box.lines.away.map((l) => ({ l, teamId: awayTeamId, teamAbbr: box.awayTeam.abbr })),
  ].filter((x) => isNotable(x.l));

  // Rank by how far each line clears its threshold, roughly.
  lines.sort((a, b) => statScore(b.l) - statScore(a.l));

  const homeWon = box.finalHome > box.finalAway;
  const tie = box.finalHome === box.finalAway;
  const rivalryDetail = !tie && rivalry
    ? rivalryHeadlineFragment(rivalry, {
        winnerTeamId: homeWon ? homeTeamId : awayTeamId,
        winnerAbbr: homeWon ? box.homeTeam.abbr : box.awayTeam.abbr,
        loserAbbr: homeWon ? box.awayTeam.abbr : box.homeTeam.abbr,
      })
    : null;

  return lines.slice(0, 2).map(({ l, teamId, teamAbbr }) => ({
    teamId,
    headline: `${l.name} (${teamAbbr}) ${describe(l)}`,
    detail: rivalryDetail ?? `${box.awayTeam.abbr} @ ${box.homeTeam.abbr}, Week result.`,
  }));
}

function statScore(l: BoxLine): number {
  const s = l.stats;
  return (s.passYds ?? 0) * 1 + (s.passTd ?? 0) * 50 + (s.rushYds ?? 0) * 1.5 + (s.rushTd ?? 0) * 50 +
    (s.recYds ?? 0) * 1.5 + (s.recTd ?? 0) * 50 + (s.sacks ?? 0) * 60 + (s.defInt ?? 0) * 70 + (s.fgm ?? 0) * 30;
}
