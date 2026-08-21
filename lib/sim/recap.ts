import { Rng } from '../rng';
import { BoxScore, BoxLine } from '../types';
import { LeagueSettings } from '../settings';
import { RivalryProfile, rivalryRecapLine } from '../rivalry';

/**
 * Recap text generation. Template-driven — it reads the box score it was
 * handed and picks phrasing from the actual shape of the game (blowout vs
 * one-score, turnover-driven, a single dominant performance, etc).
 *
 * [PLACEHOLDER copy] Every string below is first-draft writing. The structure
 * is what matters: pick a FRAME from the margin, a CAUSE from the stats, and a
 * STAR from the best line, then assemble.
 */

const BLOWOUT_MARGIN = 21;   // [TUNE]
const COMFORTABLE_MARGIN = 11;

/**
 * `rivalry`, if passed, MUST be computed BEFORE this game was recorded (the
 * head-to-head state entering it) — see lib/rivalry.ts's rivalryRecapLine
 * for why. Optional and defaulted so every existing caller keeps compiling
 * unchanged until it's wired up.
 */
export function generateRecap(box: BoxScore, settings: LeagueSettings, rng: Rng, rivalry?: RivalryProfile | null): string {
  const homeWon = box.finalHome > box.finalAway;
  const tie = box.finalHome === box.finalAway;
  const winner = homeWon ? box.homeTeam : box.awayTeam;
  const loser = homeWon ? box.awayTeam : box.homeTeam;
  const wScore = Math.max(box.finalHome, box.finalAway);
  const lScore = Math.min(box.finalHome, box.finalAway);
  const margin = wScore - lScore;

  const winnerLines = homeWon ? box.lines.home : box.lines.away;
  const loserLines = homeWon ? box.lines.away : box.lines.home;
  const wStats = homeWon ? box.teamStats.home : box.teamStats.away;
  const lStats = homeWon ? box.teamStats.away : box.teamStats.home;

  const star = pickStar(winnerLines);
  const loserStar = pickStar(loserLines);

  const sentences: string[] = [];

  // --- Frame -----------------------------------------------------------------
  if (tie) {
    sentences.push(
      rng.pick([
        `Nobody blinked. ${box.awayTeam.name} and ${box.homeTeam.name} traded punches for sixty minutes and change and walked off tied at ${wScore}.`,
        `Sixty minutes, plus overtime, and still nothing separated them: ${box.awayTeam.name} ${box.finalAway}, ${box.homeTeam.name} ${box.finalHome}.`,
      ]),
    );
  } else if (margin >= BLOWOUT_MARGIN) {
    sentences.push(
      rng.pick([
        `The ${winner.name} were never threatened, rolling past the ${loser.name} ${wScore}-${lScore}.`,
        `This one was decided by halftime. ${winner.name} ${wScore}, ${loser.name} ${lScore}.`,
        `A statement afternoon for the ${winner.name}, who buried the ${loser.name} ${wScore}-${lScore}.`,
      ]),
    );
  } else if (margin >= COMFORTABLE_MARGIN) {
    sentences.push(
      rng.pick([
        `The ${winner.name} controlled the game where it mattered and beat the ${loser.name} ${wScore}-${lScore}.`,
        `${winner.name} ${wScore}, ${loser.name} ${lScore} — closer on the scoreboard than it felt on the field.`,
      ]),
    );
  } else {
    sentences.push(
      rng.pick([
        `It came down to the last possession. The ${winner.name} survived ${wScore}-${lScore}.`,
        `One-score game the whole way: ${winner.name} ${wScore}, ${loser.name} ${lScore}.`,
        `The ${loser.name} had their chances. The ${winner.name} had one more, and won it ${wScore}-${lScore}.`,
      ]),
    );
  }

  // --- Rivalry context ---------------------------------------------------
  if (rivalry && !tie) {
    const line = rivalryRecapLine(rivalry, { winnerTeamId: winner.id, winnerName: winner.name, loserName: loser.name }, rng);
    if (line) sentences.push(line);
  }

  // --- Cause -----------------------------------------------------------------
  if (lStats.turnovers - wStats.turnovers >= 2) {
    sentences.push(
      `Turnovers told the story — ${loser.abbr} gave it away ${lStats.turnovers} times to just ${wStats.turnovers} for the ${winner.abbr}.`,
    );
  } else if (wStats.rushYards > 150) {
    sentences.push(`${winner.abbr} leaned on the run game for ${wStats.rushYards} yards on the ground and let the clock do the rest.`);
  } else if (wStats.passYards > 300) {
    sentences.push(`${winner.abbr} threw for ${wStats.passYards} and never let the ${loser.name} settle into coverage.`);
  } else if (wStats.sacks >= 4) {
    sentences.push(`The pass rush decided it: ${wStats.sacks} sacks, and the ${loser.name} never found a rhythm.`);
  } else {
    sentences.push(`${winner.abbr} outgained ${loser.abbr} ${wStats.totalYards} to ${lStats.totalYards}.`);
  }

  // --- Star ------------------------------------------------------------------
  if (star) sentences.push(describeLine(star, true, rng));
  if (settings.recapVerbosity !== 'SHORT' && loserStar) {
    sentences.push(`For the ${loser.name}, ${describeLine(loserStar, false, rng)}`);
  }

  // --- Detail ----------------------------------------------------------------
  if (settings.recapVerbosity === 'DETAILED') {
    const scoringDrives = box.drives.filter((d) => d.points > 0).length;
    sentences.push(
      `${scoringDrives} of ${box.drives.length} drives ended in points. Time of possession favored ${
        wStats.timeOfPossession >= lStats.timeOfPossession ? winner.abbr : loser.abbr
      }.`,
    );
    const edge = homeWon
      ? box.units.home.off - box.units.away.def
      : box.units.away.off - box.units.home.def;
    sentences.push(
      `Matchup note: the winning offense graded out ${edge >= 0 ? '+' : ''}${edge.toFixed(1)} against that defense coming in.`,
    );
  }

  if (box.injuries.length > 0) {
    const i = box.injuries[0];
    sentences.push(
      `Injury report: ${i.name} left the game and is expected to miss ${i.weeks} week${i.weeks === 1 ? '' : 's'}.`,
    );
  }

  return sentences.join(' ');
}

function pickStar(lines: BoxLine[]): BoxLine | null {
  let best: BoxLine | null = null;
  let bestScore = -1;
  for (const l of lines) {
    const s = l.stats;
    // Crude fantasy-ish score used only to find the headline performer. [TUNE]
    const score =
      (s.passYds ?? 0) * 0.04 + (s.passTd ?? 0) * 4 - (s.int ?? 0) * 2 +
      (s.rushYds ?? 0) * 0.1 + (s.rushTd ?? 0) * 6 +
      (s.recYds ?? 0) * 0.1 + (s.recTd ?? 0) * 6 +
      (s.sacks ?? 0) * 4 + (s.defInt ?? 0) * 5 + (s.tackles ?? 0) * 0.3 +
      (s.fgm ?? 0) * 2;
    if (score > bestScore) { bestScore = score; best = l; }
  }
  return best;
}

function describeLine(l: BoxLine, isWinner: boolean, rng: Rng): string {
  const s = l.stats;
  const lead = isWinner
    ? rng.pick([`${l.name} carried them:`, `${l.name} was the difference:`, `${l.name} set the tone:`])
    : `${l.name} did what he could:`;

  const parts: string[] = [];
  if (s.passAtt) parts.push(`${s.passCmp}/${s.passAtt} for ${s.passYds}, ${s.passTd} TD${(s.int ?? 0) > 0 ? `, ${s.int} INT` : ''}`);
  if ((s.rushAtt ?? 0) > 4) parts.push(`${s.rushAtt} carries for ${s.rushYds}${(s.rushTd ?? 0) > 0 ? ` and ${s.rushTd} score${s.rushTd === 1 ? '' : 's'}` : ''}`);
  if ((s.rec ?? 0) > 2) parts.push(`${s.rec} catches for ${s.recYds}${(s.recTd ?? 0) > 0 ? ` and a touchdown` : ''}`);
  if ((s.sacks ?? 0) > 0) parts.push(`${s.sacks} sack${s.sacks === 1 ? '' : 's'}`);
  if ((s.defInt ?? 0) > 0) parts.push(`${s.defInt} interception${s.defInt === 1 ? '' : 's'}`);
  if ((s.tackles ?? 0) >= 8 && parts.length === 0) parts.push(`${s.tackles} tackles`);
  if ((s.fgm ?? 0) >= 3) parts.push(`${s.fgm}-for-${s.fga} on field goals`);

  return `${lead} ${parts.join(', ') || 'a quiet but steady afternoon'}.`;
}

/** One-line summary used in schedule/standings lists. */
export function shortResult(box: BoxScore): string {
  const homeWon = box.finalHome > box.finalAway;
  const w = homeWon ? box.homeTeam.abbr : box.awayTeam.abbr;
  const l = homeWon ? box.awayTeam.abbr : box.homeTeam.abbr;
  if (box.finalHome === box.finalAway) return `${box.awayTeam.abbr} ${box.finalAway} — ${box.homeTeam.abbr} ${box.finalHome} (T)`;
  return `${w} ${Math.max(box.finalHome, box.finalAway)}, ${l} ${Math.min(box.finalHome, box.finalAway)}`;
}
