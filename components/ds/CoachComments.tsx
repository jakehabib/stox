'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import type { CoachPayload, CoachLine, CoachTeamContext } from '@/lib/weekReport';
import {
  gradeLine, playedEnough, statLine, findConcerns, addStats, hasDistinguishingEvent,
  UNIT_OF, UNIT_ORDER, UNIT_LABEL, UnitKey,
  mentionBar, SECOND_FROM_UNIT_BAR, MAX_MENTIONS,
} from '@/lib/coachRoom';
import type { SeasonStats } from '@/lib/types';
import { Rng } from '@/lib/rng';
import { PlayerAvatar } from '../PlayerAvatar';

/**
 * ===========================================================================
 * COACH'S COMMENTS — the expandable half of the Week Report
 * ===========================================================================
 * The game ball answers "who had the loudest afternoon" and prints one man.
 * This answers the two questions a coach actually opens the room with: who
 * beat what is normal for his job, and what actually cost us. Then it says
 * the part that is not about any individual at all.
 *
 * THREE RULES, and they are the whole design.
 *
 * 1. COLLAPSED, AND FREE UNTIL OPENED. The Week Report is on the path a
 *    player walks seventeen times a season; the standing veto is that
 *    anything which makes an experienced player wait gets deleted rather than
 *    tuned. So nothing in this file runs until the section is opened — the
 *    model is built once, lazily, on the first expand, and the server ships
 *    numbers rather than sentences precisely so that it can be.
 *
 * 2. POSITION-DIVERSE BY CONSTRUCTION, not by luck. Selection takes the best
 *    man in each UNIT before it takes a second from any, so the mix cannot
 *    collapse onto whichever position the arithmetic happens to favour —
 *    that is structural, not a hope. Ranking is lib/performanceScore.ts's,
 *    the same one All-Star selection uses; lib/coachRoom.ts only supplies the
 *    week's yardstick and the bars.
 *
 *    Measured over 2,255 real user-team weeks in this database, the mentions
 *    come out 17.3% running back, 17.2% receiver, 14.1% defensive tackle,
 *    13.0% corner, 10.8% safety, 10.3% edge, 4.8% linebacker, 4.5% tight end,
 *    4.3% quarterback, 3.6% kicker — ten positions, none of them a fifth of
 *    the list, and three a week on average. The ranker that picks the single
 *    game ball above gives the quarterback four weeks in six.
 *
 *    The quarterback's 4.3% is not a bug and is not him being punished: there
 *    is exactly one of him on the sheet, against five receivers and four
 *    backs, so 4.3% of mentions is the most-mentioned INDIVIDUAL on the
 *    roster. He is named on 13% of weeks, which is what "he cleared the 78th
 *    percentile at his own position" comes to.
 *
 * 3. EVERY SENTENCE CARRIES A NUMBER, and no sentence claims anything the
 *    box score did not record. The clause pools below are strictly
 *    EVALUATIVE — "that's a day's work", "he answered" — never DESCRIPTIVE.
 *    Nothing here may say a man was unstoppable on third down, because
 *    lib/sim/engine.ts's third-down figure is `plays/6` over `plays/4` and is
 *    the same ~67% for every team in every game ever played. The same goes
 *    for penalties (`plays/12`) and for the team pass/rush split (a flat
 *    60/40 of total yards). Those numbers exist and they are all lies; the
 *    payload deliberately does not carry them, and the real rushing and
 *    passing yardage is summed off the player lines instead.
 *
 * Phrase selection is a seeded `Rng` (lib/rng.ts) keyed on the week and the
 * player, so the same week re-renders to the same comments forever.
 * ===========================================================================
 */

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

interface Mention {
  playerId: string;
  name: string;
  position: string;
  unit: UnitKey;
  /**
   * 0-100. For one week it is a percentile: the share of games at his position
   * that were worse. For a span it is the MEAN of his weekly percentiles,
   * which is a different quantity — the badge and its tooltip say which, and
   * never print an average as though it were a percentile of the stretch.
   */
  grade: number;
  line: string;
  clause: string;
  games: number;
  rookie: boolean;
  age: number;
  heightIn: number;
  weightLb: number;
}

interface ConcernRow {
  playerId: string;
  name: string;
  position: string;
  line: string;
  clause: string;
}

interface CoachModel {
  weeks: number;
  opener: string;
  topLabel: string;
  top: Mention[];
  topEmpty: string | null;
  concerns: ConcernRow[];
  concernsEmpty: string | null;
  notes: string[];
}

/** One player's whole span, folded. */
interface Folded {
  line: CoachLine;
  stats: SeasonStats;
  games: number;
  gradeSum: number;
  gradeGames: number;
  best: number;
}

function fold(payloads: CoachPayload[]): Map<string, Folded> {
  const by = new Map<string, Folded>();
  for (const p of payloads) {
    for (const l of p.lines) {
      const cur = by.get(l.playerId);
      const next: Folded = cur
        ? { ...cur, stats: addStats(cur.stats, l.stats), games: cur.games + 1 }
        : { line: l, stats: l.stats, games: 1, gradeSum: 0, gradeGames: 0, best: 0 };
      // Graded PER GAME and averaged. The yardstick in lib/coachRoom.ts is a
      // per-game distribution, so handing it a seven-game total would put
      // every starter past the 99th percentile and mean nothing.
      if (playedEnough(l.position, l.stats)) {
        const g = gradeLine(l.position, l.stats);
        if (g) { next.gradeSum += g.score; next.gradeGames += 1; next.best = Math.max(next.best, g.score); }
      }
      by.set(l.playerId, next);
    }
  }
  return by;
}

/**
 * The best man in each unit, then the rare second man, then unit order.
 *
 * A span demands he was actually there for it: a back who played one of seven
 * weeks did not carry the stretch, whatever he did that afternoon.
 */
function pickTop(folded: Map<string, Folded>, weeks: number, voice: Voice): Mention[] {
  const minGames = weeks > 1 ? Math.ceil(weeks / 2) : 1;
  const eligible = [...folded.values()]
    .filter((f) => f.gradeGames > 0 && UNIT_OF[f.line.position])
    // A defender needs something the engine only writes when something
    // actually happened — see hasDistinguishingEvent() in lib/coachRoom.ts.
    // Tackles are a flat roll between four and seven, so "seven tackles, that
    // is the tape we show the room" would be praising dice in a coach's voice.
    .filter((f) => hasDistinguishingEvent(f.line.position, f.stats, f.games))
    .map((f) => ({ f, unit: UNIT_OF[f.line.position], avg: f.gradeSum / f.gradeGames }))
    .filter((x) => weeks === 1 || x.f.gradeGames >= minGames)
    .sort((a, b) => b.avg - a.avg);

  // Both bars scale with the length of the stretch — see mentionBar() in
  // lib/coachRoom.ts. Averaging seven weekly percentiles is a far quieter
  // number than any one of them, so a flat bar silently triples its own demand
  // on a seven-week advance and answers "who carried this" with "nobody".
  const bar = mentionBar(weeks);
  const secondBar = mentionBar(weeks, SECOND_FROM_UNIT_BAR);

  const takenUnits = new Set<UnitKey>();
  const chosen: typeof eligible = [];
  for (const x of eligible) {
    if (chosen.length >= MAX_MENTIONS) break;
    if (takenUnits.has(x.unit) || x.avg < bar) continue;
    takenUnits.add(x.unit);
    chosen.push(x);
  }
  // A second man from the same unit, but only when he did something DIFFERENT.
  // Defensive grades saturate — a sack and five tackles is a top-5% edge game
  // and three men can post it in the same afternoon — so without this check a
  // report could print two identical rows with two identical sentences, which
  // is the clearest possible signal that a template wrote them.
  for (const x of eligible) {
    if (chosen.length >= MAX_MENTIONS) break;
    if (chosen.includes(x) || x.avg < secondBar) continue;
    const phrase = headlinePhrase(x.f, weeks);
    if (chosen.some((c) => c.unit === x.unit && headlinePhrase(c.f, weeks) === phrase)) continue;
    chosen.push(x);
  }

  return chosen
    .sort((a, b) => UNIT_ORDER.indexOf(a.unit) - UNIT_ORDER.indexOf(b.unit))
    .map(({ f, unit, avg }) => ({
      playerId: f.line.playerId,
      name: f.line.name,
      position: f.line.position,
      unit,
      grade: avg,
      line: statLine(f.line.position, f.stats),
      clause: praise(f, avg, weeks, voice),
      games: f.games,
      rookie: f.line.experience === 0,
      age: f.line.age,
      heightIn: f.line.heightIn,
      weightLb: f.line.weightLb,
    }));
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

/**
 * Evaluative tags only. Not one of these asserts anything about HOW a play
 * happened — the simulation does not model a route or a blitz, so a comment
 * that described one would be invented. They attach to a figure that is
 * always printed immediately before them.
 */
const VOICE_HUGE = [
  'That is about as good as that job gets.',
  "That's the tape we show the room.",
  'You cannot ask a man for more than that.',
  'That is a Sunday he keeps.',
  'Nobody in the room did better than that.',
];
const VOICE_BIG = [
  "That's a day's work.",
  'He answered.',
  "We'll take that every week.",
  "That's why he is out there.",
];
const VOICE_SOLID = [
  'Did his job.',
  'That counted.',
  'Steady.',
  'He gave us what we needed.',
];

/**
 * "an interception", "two sacks". A coach does not say "1 sacks" — and the
 * plural is a parameter because the default of singular + "s" is wrong the
 * moment the noun is a phrase: "three trip to the end zones" is exactly the
 * kind of seam that tells a reader a template wrote the sentence.
 */
const COUNT_WORD = ['no', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
function count(n: number, singular: string, plural = `${singular}s`): string {
  if (n === 1) return `${/^[aeiou]/i.test(singular) ? 'an' : 'a'} ${singular}`;
  return `${COUNT_WORD[n] ?? n} ${plural}`;
}

/**
 * The specific things he did, named — up to two of them, because a strip-sack
 * is one afternoon and printing only the sack undersells it while printing
 * the whole box line is not a sentence. Every clause is a restatement of a
 * figure that is also printed underneath it.
 */
function headlinePhrase(f: Folded, weeks: number): string {
  const s = f.stats as Record<string, number | undefined>;
  const pos = f.line.position;
  const over = weeks > 1 ? ` over ${f.games} game${f.games === 1 ? '' : 's'}` : '';
  const bits: string[] = [];
  const push = (b: string) => { if (bits.length < 2) bits.push(b); };

  if (pos === 'QB') {
    if ((s.passTd ?? 0) > 0) push(count(s.passTd ?? 0, 'touchdown throw'));
    if ((s.passYds ?? 0) > 0) push(`${s.passYds} through the air`);
    if ((s.rushTd ?? 0) > 0) push(count(s.rushTd ?? 0, 'score with his legs', 'scores with his legs'));
  } else if (pos === 'RB') {
    if ((s.rushYds ?? 0) > 0) push(`${s.rushYds} on the ground off ${s.rushAtt ?? 0} carries`);
    if ((s.rushTd ?? 0) > 0) push(count(s.rushTd ?? 0, 'score'));
    if ((s.rec ?? 0) >= 3) push(count(s.rec ?? 0, 'catch', 'catches'));
  } else if (pos === 'WR' || pos === 'TE') {
    if ((s.recYds ?? 0) > 0) push(`${s.recYds} on ${count(s.rec ?? 0, 'catch', 'catches')}`);
    if ((s.recTd ?? 0) > 0) push(count(s.recTd ?? 0, 'trip to the end zone', 'trips to the end zone'));
  } else if (pos === 'EDGE' || pos === 'DT') {
    if ((s.sacks ?? 0) > 0) push(count(s.sacks ?? 0, 'sack'));
    if ((s.ff ?? 0) > 0) push(count(s.ff ?? 0, 'forced fumble'));
    if (bits.length === 0) push(`${s.tackles ?? 0} tackles`);
  } else if (pos === 'LB' || pos === 'CB' || pos === 'S') {
    if ((s.defInt ?? 0) > 0) push(count(s.defInt ?? 0, 'interception'));
    if ((s.ff ?? 0) > 0) push(count(s.ff ?? 0, 'forced fumble'));
    if ((s.pd ?? 0) > 0) push(`${s.pd} ball${(s.pd ?? 0) === 1 ? '' : 's'} broken up`);
    if (bits.length === 0) push(`${s.tackles ?? 0} tackles`);
  } else if (pos === 'K') {
    push(`${s.fgm ?? 0} of ${s.fga ?? 0} from the field`);
    if ((s.xpm ?? 0) > 0) push(`${s.xpm} of ${s.xpa ?? 0} on extra points`);
  }

  if (bits.length === 0) return `${statLine(pos, f.stats)}${over}.`;
  return `${capitalise(bits.join(' and '))}${over}.`;
}

/**
 * Draws a voice tag without repeating one inside a single report. Two rows
 * ending in the same four words is the tell that a template wrote them, and
 * the section stops sounding like a person the moment a reader spots it.
 */
class Voice {
  private queues = new Map<string[], string[]>();
  private last = new Map<string[], string>();
  constructor(private rng: Rng) {}
  pick(pool: string[]): string {
    let q = this.queues.get(pool);
    if (!q || q.length === 0) {
      q = this.rng.shuffle(pool);
      // A refill is where the repeat used to sneak in: three tags, four men
      // over the bar, and the fourth row ended in the same four words as the
      // third. Rotating the reshuffled queue when its next draw matches the
      // one just used costs nothing and closes it.
      if (q.length > 1 && q[q.length - 1] === this.last.get(pool)) q.unshift(q.pop()!);
      this.queues.set(pool, q);
    }
    const picked = q.pop()!;
    this.last.set(pool, picked);
    return picked;
  }
}

/**
 * [TUNE] Where the loudest verdicts start.
 *
 * Deliberately high, and measured: a mention is already the BEST man in his
 * unit and already past the 78th percentile, so the grades that reach this
 * function are an extreme order statistic rather than a sample of the league.
 * At 95 and 88 the top tier fired on 38.6% of all mentions — "that is about as
 * good as that job gets", four times a month — which is not a compliment any
 * more, it is a tic. At 99 and 92 it is 17.6% and 30%, or roughly one loudest
 * verdict every other report.
 *
 * Both run through mentionBar() so a span is judged on the same footing as an
 * afternoon: an average of seven weekly percentiles cannot reach 99 and should
 * not have to.
 */
const VOICE_HUGE_AT = 99;
const VOICE_BIG_AT = 92;

function praise(f: Folded, grade: number, weeks: number, voice: Voice): string {
  const pool = grade >= mentionBar(weeks, VOICE_HUGE_AT)
    ? VOICE_HUGE
    : grade >= mentionBar(weeks, VOICE_BIG_AT) ? VOICE_BIG : VOICE_SOLID;
  return `${headlinePhrase(f, weeks)} ${voice.pick(pool)}`;
}

/**
 * The careful half. A player appears here ONLY for something that measurably
 * cost the team, on a workload big enough for the rate to mean anything —
 * never for a quiet game, and never for a bench player's four snaps. See
 * findConcerns() in lib/coachRoom.ts for every gate.
 *
 * One row per man, however many things went wrong. Three separate lines about
 * the same quarterback is a pile-on, not a report.
 */
function pickConcerns(folded: Map<string, Folded>, weeks: number, voice: Voice, praised: Set<string>): ConcernRow[] {
  const rows = [...folded.values()]
    // Never a man the same sheet just praised. A receiver can genuinely have
    // both a good afternoon and a poor catch rate, but printing "72 on six
    // catches and a trip to the end zone — we'll take that every week" three
    // inches above "six of fourteen thrown his way — not good enough" reads as
    // a bug, not as nuance, and the section only works if a reader trusts it.
    .filter((f) => !praised.has(f.line.playerId))
    .map((f) => ({ f, list: findConcerns(f.line.position, f.stats, f.games) }))
    .filter((x) => x.list.length > 0)
    .map((x) => ({ ...x, worst: Math.max(...x.list.map((c) => c.severity)) }))
    .sort((a, b) => b.worst - a.worst)
    .slice(0, 2);

  return rows.map(({ f, list, worst }) => {
    const facts = list.sort((a, b) => b.severity - a.severity).slice(0, 2).map((c) => c.fact);
    const tail = worst >= 80
      ? voice.pick(CONCERN_HEAVY)
      : voice.pick(CONCERN_LIGHT);
    const over = weeks > 1 ? ` across ${f.games} game${f.games === 1 ? '' : 's'}` : '';
    return {
      playerId: f.line.playerId,
      name: f.line.name,
      position: f.line.position,
      line: statLine(f.line.position, f.stats),
      clause: `${capitalise(facts.join(', '))}${over}. ${tail}`,
    };
  });
}

const INJURY_TAIL = [
  'Next man up.',
  'Somebody else has that job now.',
  'We plan around it.',
  'That changes the week.',
];

const CONCERN_HEAVY = ['That is where the game went.', 'We cannot win giving it away like that.', 'That has to be cleaned up.'];
const CONCERN_LIGHT = ['Not good enough.', 'We need more than that.', 'That is on him and on us.'];

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "once" / "twice" / "five times". A coach does not say "1 times". */
function times(n: number): string {
  return n === 0 ? 'not once' : n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;
}

// ---------------------------------------------------------------------------
// Beyond individuals
// ---------------------------------------------------------------------------

function sumTeam(payloads: CoachPayload[]): CoachTeamContext | null {
  const ts = payloads.map((p) => p.team).filter((t): t is CoachTeamContext => !!t);
  if (ts.length === 0) return null;
  return ts.reduce((a, b) => ({
    points: a.points + b.points,
    oppPoints: a.oppPoints + b.oppPoints,
    totalYards: a.totalYards + b.totalYards,
    oppTotalYards: a.oppTotalYards + b.oppTotalYards,
    rushYards: a.rushYards + b.rushYards,
    rushAtt: a.rushAtt + b.rushAtt,
    passYards: a.passYards + b.passYards,
    passAtt: a.passAtt + b.passAtt,
    turnovers: a.turnovers + b.turnovers,
    oppTurnovers: a.oppTurnovers + b.oppTurnovers,
    sacksFor: a.sacksFor + b.sacksFor,
    sacksAgainst: a.sacksAgainst + b.sacksAgainst,
    possession: (a.possession * (ts.length - 1) + b.possession) / ts.length,
    drives: a.drives + b.drives,
    scoringDrives: a.scoringDrives + b.scoringDrives,
    emptyDrives: a.emptyDrives + b.emptyDrives,
  }));
}

function buildNotes(payloads: CoachPayload[], folded: Map<string, Folded>, weeks: number, voice: Voice): string[] {
  const notes: string[] = [];
  const t = sumTeam(payloads);
  const last = payloads[payloads.length - 1];

  if (t) {
    // Which side of the ball moved it. Summed off the player lines — the box
    // score's own split is a fixed 60/40 of total yards and says nothing.
    if (t.rushAtt > 0 || t.passAtt > 0) {
      const ypc = t.rushAtt > 0 ? (t.rushYards / t.rushAtt).toFixed(1) : null;
      notes.push(
        `We ran it ${t.rushAtt} times for ${t.rushYards}${ypc ? ` (${ypc} a carry)` : ''} and threw for ${t.passYards} on ${t.passAtt} attempts.`,
      );
    }
    if (t.drives > 0) {
      notes.push(`${t.scoringDrives} of ${t.drives} possessions produced points; ${t.emptyDrives} ended in a punt, a turnover or on downs.`);
    }
    const diff = t.oppTurnovers - t.turnovers;
    if (t.turnovers > 0 || t.oppTurnovers > 0) {
      notes.push(
        diff > 0
          ? `We took it away ${times(t.oppTurnovers)} and gave it back ${t.turnovers}. Plus ${diff} in that column.`
          : diff < 0
            ? `We gave it away ${times(t.turnovers)} and took ${t.oppTurnovers}. Minus ${-diff} in that column, and that is where games go.`
            : `${capitalise(t.turnovers === 1 ? 'one giveaway' : `${COUNT_WORD[t.turnovers] ?? t.turnovers} giveaways`)} each. Even in that column.`,
      );
    }
    if (t.sacksFor > 0 || t.sacksAgainst > 0) {
      notes.push(
        t.sacksFor === 0
          ? `The front did not get home once; they got to our passer ${times(t.sacksAgainst)}.`
          : `The front got home ${times(t.sacksFor)}; they got to our passer ${times(t.sacksAgainst)}.`,
      );
    }
  }

  // The shape of the afternoon, off lib/gameShape.ts's SIGNED figures rather
  // than its `note`. That note is written to sit beside the archetype tag the
  // panel already prints — read on its own, "25 clear after three quarters"
  // does not say who was clear, and printing it under a 33-point defeat would
  // read as a claim about us. Every number below is signed from our side.
  if (weeks === 1 && last?.shape) {
    const s = last.shape;
    const bits: string[] = [];
    if (s.marginAfterQ3 !== 0) {
      bits.push(`three quarters in we were ${s.marginAfterQ3 > 0 ? 'up' : 'down'} ${Math.abs(s.marginAfterQ3)}`);
    } else {
      bits.push('it was level after three quarters');
    }
    if (s.largestLead > 0) bits.push(`biggest lead we held was ${s.largestLead}`);
    if (s.largestDeficit > 0) bits.push(`deepest hole ${s.largestDeficit}`);
    if (s.leadChanges > 0) bits.push(`${s.leadChanges} lead change${s.leadChanges === 1 ? '' : 's'}`);
    notes.push(`${capitalise(bits.join(', '))}.`);
  }

  // Who is not available next week. This is the line that changes a lineup,
  // so it is the only place in the section that names a man for something he
  // had no say in — and it says nothing about how he played.
  const hurt = payloads.flatMap((p) => p.injuries);
  for (const i of hurt.slice(0, 2)) {
    notes.push(
      `${i.name}${i.position ? ` (${i.position})` : ''} — ${i.type.toLowerCase()}, out ${i.weeks} week${i.weeks === 1 ? '' : 's'}. ${voice.pick(INJURY_TAIL)}`,
    );
  }

  if (weeks > 1) notes.push(...spanNotes(payloads, folded, hurt.map((h) => h.playerId)));
  return notes;
}

/**
 * What only a STRETCH can show. A single week cannot tell you a man lost his
 * job; seven weeks side by side can, and it is the thing a GM most needs to
 * be told after skipping to the playoffs.
 *
 * The test is deliberately strict — he led the position in week one of the
 * span, somebody else leads it in the last week, and his own workload
 * collapsed to under 40% of what it was. A back who simply had a quiet
 * Sunday does not trip it, and a man who is on the injury list gets the
 * injury sentence rather than this one.
 */
function spanNotes(payloads: CoachPayload[], folded: Map<string, Folded>, hurtIds: string[]): string[] {
  const out: string[] = [];
  const first = payloads[0];
  const last = payloads[payloads.length - 1];
  if (!first || !last || first === last) return out;

  const leader = (p: CoachPayload, pos: string, key: keyof SeasonStats) => {
    const rows = p.lines.filter((l) => l.position === pos && ((l.stats[key] as number | undefined) ?? 0) > 0);
    return rows.sort((a, b) => ((b.stats[key] as number) ?? 0) - ((a.stats[key] as number) ?? 0))[0] ?? null;
  };

  for (const [pos, key, noun] of [['QB', 'passAtt', 'the huddle'], ['RB', 'rushAtt', 'the carries']] as const) {
    const was = leader(first, pos, key);
    const now = leader(last, pos, key);
    if (!was || !now || was.playerId === now.playerId) continue;
    if (hurtIds.includes(was.playerId)) continue;
    const then = (was.stats[key] as number) ?? 0;
    const nowHis = (last.lines.find((l) => l.playerId === was.playerId)?.stats[key] as number | undefined) ?? 0;
    if (then === 0 || nowHis > then * 0.4) continue;
    out.push(
      `${was.name} had ${noun} in ${first.weekLabel} (${then}) and ${nowHis} by ${last.weekLabel}. ${now.name} has it now — ${(now.stats[key] as number) ?? 0}.`,
    );
  }

  // The rookie who became a real player during the stretch. Only sayable
  // because we are holding every week side by side: he cleared the workload
  // gate for the first time somewhere in the middle of it, having not cleared
  // it in the opening week. A single report cannot know this, and nothing here
  // claims it was his first game ever — only his first real one of the span,
  // which is exactly what the payloads can prove.
  const firstWeekRealWork = new Set(
    first.lines.filter((l) => playedEnough(l.position, l.stats)).map((l) => l.playerId),
  );
  for (let i = 1; i < payloads.length && out.length < 3; i++) {
    for (const l of payloads[i].lines) {
      if (l.experience !== 0 || firstWeekRealWork.has(l.playerId)) continue;
      if (!playedEnough(l.position, l.stats)) continue;
      const f = folded.get(l.playerId);
      if (!f || f.games < 2) continue;
      firstWeekRealWork.add(l.playerId);
      out.push(`${l.name} (${l.position}), a rookie, got his first real workload of the stretch in ${payloads[i].weekLabel} — ${statLine(l.position, l.stats)}.`);
      break;
    }
  }

  const record = payloads.reduce(
    (a, p) => ({ w: a.w + (p.outcome === 'W' ? 1 : 0), l: a.l + (p.outcome === 'L' ? 1 : 0), t: a.t + (p.outcome === 'T' ? 1 : 0) }),
    { w: 0, l: 0, t: 0 },
  );
  out.unshift(`${record.w}-${record.l}${record.t ? `-${record.t}` : ''} over the stretch.`);
  return out;
}

const OPENER_WIN = [
  'Here is what stood up.', 'Here is what travelled.', 'Here is what I liked.',
  'Here is what we keep.', 'Here is what won it.',
];
const OPENER_LOSS = [
  'Here is what has to change.', 'Here is where it went.', 'Here is the honest read.',
  'Here is what I saw.', 'Here is what we fix.',
];

function buildOpener(payloads: CoachPayload[], weeks: number, voice: Voice): string {
  const t = sumTeam(payloads);
  if (weeks > 1) {
    const w = payloads.filter((p) => p.outcome === 'W').length;
    const l = payloads.filter((p) => p.outcome === 'L').length;
    const scoreline = t ? ` We scored ${t.points} and gave up ${t.oppPoints}.` : '';
    return `${weeks} weeks, ${w} win${w === 1 ? '' : 's'} and ${l} loss${l === 1 ? '' : 'es'}.${scoreline}`;
  }
  const p = payloads[0];
  if (!p || !p.team) return 'We were not on the slate.';
  const m = Math.abs(p.margin);
  const verb = p.outcome === 'W' ? 'won' : p.outcome === 'L' ? 'lost' : 'tied';
  const head = p.outcome === 'T'
    ? `We tied it ${p.team.points}-${p.team.oppPoints}.`
    : `We ${verb} it by ${m}, ${p.team.points}-${p.team.oppPoints}${p.oppAbbr ? ` against ${p.oppAbbr}` : ''}.`;
  const tail = p.outcome === 'W'
    ? voice.pick(OPENER_WIN)
    : voice.pick(OPENER_LOSS);
  return `${head} ${tail}`;
}

export function buildCoachModel(payloadsIn: (CoachPayload | null | undefined)[]): CoachModel | null {
  const payloads = payloadsIn.filter((p): p is CoachPayload => !!p);
  if (payloads.length === 0) return null;
  const weeks = payloads.length;

  // Seeded on the span itself, so the same week re-renders to the same
  // sentences forever — including after a refresh, a resize, or a StrictMode
  // double render.
  const voice = new Voice(new Rng(`coach:${payloads.map((p) => p.gameId ?? p.weekLabel).join('|')}`));

  const folded = fold(payloads);
  const top = pickTop(folded, weeks, voice);
  const concerns = pickConcerns(folded, weeks, voice, new Set(top.map((m) => m.playerId)));
  const t = sumTeam(payloads);

  return {
    weeks,
    opener: buildOpener(payloads, weeks, voice),
    topLabel: weeks > 1 ? 'Who carried the stretch' : 'Who showed up',
    top,
    topEmpty: top.length === 0
      ? `Nobody beat what is normal for his job${t ? ` — ${t.points} points on ${t.totalYards} yards` : ''}. That happens.`
      : null,
    concerns,
    // Deliberately says nothing factual. "Nobody gave it away" was printed on
    // a sheet whose own notes read "we gave it away twice" three lines below —
    // the engine books team turnovers that no player line carries, so the
    // absence of a name here is not the absence of a giveaway.
    concernsEmpty: concerns.length === 0 ? 'Nobody has to answer for this one.' : null,
    notes: buildNotes(payloads, folded, weeks, voice),
  };
}

// ---------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------

export function CoachComments({ payloads, leagueId, teamColor, gameBallId, onNavigate }: {
  payloads: (CoachPayload | null | undefined)[];
  leagueId: string;
  teamColor?: string | null;
  /**
   * The man the band above already handed the game ball to. He is not
   * excluded — his numbers are exactly why his unit is being mentioned — but
   * the row says so, otherwise the same name appearing twice on one panel
   * reads as a bug rather than as two questions with the same answer.
   */
  gameBallId?: string | null;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Built exactly once, on the first expand. Nothing in this file runs while
  // the section is closed, which is the whole reason the report still paints
  // as fast as it did before this existed.
  const built = useRef<CoachModel | null | undefined>(undefined);
  if (open && built.current === undefined) built.current = buildCoachModel(payloads);
  const model = open ? built.current : undefined;

  const usable = payloads.some((p) => !!p);
  if (!usable) return null;

  return (
    <div className="panel coach-comments" data-open={open ? 'true' : 'false'}>
      <style dangerouslySetInnerHTML={{ __html: `
        .coach-comments .cc-body { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .24s ease; }
        .coach-comments .cc-body > div { overflow: hidden; }
        .coach-comments[data-open="true"] .cc-body { grid-template-rows: 1fr; }
        .coach-comments .cc-caret { transition: transform .24s ease; }
        .coach-comments[data-open="true"] .cc-caret { transform: rotate(90deg); }
        @media (prefers-reduced-motion: reduce) {
          .coach-comments .cc-body, .coach-comments .cc-caret { transition: none; }
        }
      ` }} />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="coach-comments-body"
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left group"
      >
        <span className="cc-caret text-muted text-[11px] leading-none" aria-hidden="true">▶</span>
        <span className="label-sm group-hover:text-chalk transition-colors">Coach&rsquo;s comments</span>
        <span className="ml-auto text-[11px] text-muted font-mono">{open ? 'hide' : 'open'}</span>
      </button>

      <div className="cc-body" id="coach-comments-body">
        <div>
          {model && (
            <div className="px-4 pb-4 space-y-4 border-t border-line pt-3.5">
              <p className="text-[13.5px] leading-relaxed text-chalk/90 border-l-2 pl-3"
                 style={{ borderColor: teamColor ?? '#38bdf8' }}>
                {model.opener}
              </p>

              <div>
                <h4 className="label-sm mb-2.5">{model.topLabel}</h4>
                {model.topEmpty
                  ? <p className="text-[13px] text-muted">{model.topEmpty}</p>
                  : (
                    <div className="space-y-2.5">
                      {model.top.map((m) => (
                        <MentionRow
                          key={m.playerId}
                          m={m}
                          leagueId={leagueId}
                          onNavigate={onNavigate}
                          teamColor={teamColor}
                          gameBall={model.weeks === 1 && m.playerId === gameBallId}
                        />
                      ))}
                    </div>
                  )}
              </div>

              <div>
                <h4 className="label-sm mb-2.5">Didn&rsquo;t help us</h4>
                {model.concernsEmpty
                  ? <p className="text-[13px] text-muted">{model.concernsEmpty}</p>
                  : (
                    <div className="space-y-2">
                      {model.concerns.map((c) => (
                        <div key={c.playerId} className="flex gap-2.5 items-start text-[13px] leading-snug">
                          <span className="w-1.5 h-1.5 rounded-full mt-[7px] shrink-0 bg-bad" />
                          <div className="min-w-0">
                            <Link
                              href={`/league/${leagueId}/player/${c.playerId}`}
                              onClick={onNavigate}
                              className="font-display font-bold hover:text-accent2 transition-colors"
                            >
                              {c.name}
                            </Link>
                            <span className="ml-1.5 text-[10px] font-extrabold tracking-wider text-muted border border-line rounded px-1 py-px align-middle">
                              {c.position}
                            </span>
                            <span className="text-chalk/85"> — {c.clause}</span>
                            <div className="font-mono text-[11px] text-muted mt-0.5">{c.line}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
              </div>

              {model.notes.length > 0 && (
                <div>
                  <h4 className="label-sm mb-2">{model.weeks > 1 ? 'The stretch, beyond the names' : 'The rest of it'}</h4>
                  <ul className="space-y-1.5">
                    {model.notes.map((n, i) => (
                      <li key={i} className="flex gap-2.5 items-start text-[13px] leading-snug text-chalk/85">
                        <span className="w-1.5 h-1.5 rounded-full mt-[7px] shrink-0 bg-muted" />
                        <span className="min-w-0">{n}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-[11px] text-muted leading-relaxed">
                Ranked against what is normal at each position, from every box score this simulation
                has ever written. Nobody appears under &ldquo;didn&rsquo;t help us&rdquo; for a quiet game — only for
                turnovers, misses, or a poor rate on real volume.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MentionRow({ m, leagueId, onNavigate, teamColor, gameBall }: {
  m: Mention; leagueId: string; onNavigate?: () => void; teamColor?: string | null; gameBall?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      {/* Avatars and crests stay. This section is full of players, so it
          carries portraits — README, design principles. */}
      <PlayerAvatar
        seed={m.playerId}
        age={m.age}
        size={38}
        teamColor={teamColor ?? undefined}
        weightLb={m.weightLb}
        heightIn={m.heightIn}
        position={m.position}
        className="shrink-0 mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <Link
            href={`/league/${leagueId}/player/${m.playerId}`}
            onClick={onNavigate}
            className="font-display font-bold text-[14px] leading-none hover:text-accent2 transition-colors"
          >
            {m.name}
          </Link>
          <span className="text-[10px] font-extrabold tracking-wider text-muted border border-line rounded px-1 py-px">
            {m.position}
          </span>
          {gameBall && (
            <span className="text-[10px] font-extrabold tracking-wider text-accent border border-accent/40 bg-accent/10 rounded px-1 py-px">
              GAME BALL
            </span>
          )}
          {m.rookie && (
            <span className="text-[10px] font-extrabold tracking-wider text-accent2 border border-accent2/40 bg-accent2/10 rounded px-1 py-px">
              ROOKIE
            </span>
          )}
          <span
            className="ml-auto font-mono text-[10px] text-muted shrink-0"
            title={m.games > 1
              ? `His average week over the stretch ranked ahead of ${m.grade.toFixed(0)}% of games played at ${m.position} across every box score in the sim, over ${m.games} games. ${UNIT_LABEL[m.unit]}.`
              : `Better than ${m.grade.toFixed(0)}% of games played at ${m.position} across every box score in the sim. ${UNIT_LABEL[m.unit]}.`}
          >
            {m.games > 1 ? 'AVG ' : ''}TOP {Math.max(1, Math.round(100 - m.grade))}% AT {m.position}
          </span>
        </div>
        <p className="text-[13px] leading-snug text-chalk/85 mt-1">{m.clause}</p>
        <div className="font-mono text-[11px] text-muted mt-0.5">{m.line}</div>
      </div>
    </div>
  );
}
