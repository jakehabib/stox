'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import type { CoachPayload, CoachLine, CoachTeamContext } from '@/lib/weekReport';
import {
  gradeLine, playedEnough, statLine, findConcerns, addStats,
  UNIT_OF, UNIT_ORDER, UNIT_LABEL, UnitKey,
  MENTION_BAR, SECOND_FROM_UNIT_BAR, MAX_MENTIONS,
} from '@/lib/gamePerformance';
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
 *    man from each UNIT and never re-ranks across units, because
 *    lib/gamePerformance.ts's grades are only comparable inside one. Measured
 *    over 933 real user-team weeks in this database the mentions come out
 *    18.8% running back, 17.5% receiver, 12.6% defensive tackle, 11.7% edge,
 *    11.5% corner, 6.8% tight end, 6.6% safety, 5.9% quarterback, 5.5%
 *    linebacker, 3.0% kicker. The ranker that picks the single game ball
 *    gives the quarterback four weeks in six.
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
  /** 0-100 percentile among games at his position. */
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
      // Graded PER GAME and averaged. The ladders in lib/gamePerformance.ts
      // are per-game distributions, so handing them a seven-game total would
      // put every starter past the 99th percentile and mean nothing.
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
function pickTop(folded: Map<string, Folded>, weeks: number, rng: Rng): Mention[] {
  const minGames = weeks > 1 ? Math.ceil(weeks / 2) : 1;
  const eligible = [...folded.values()]
    .filter((f) => f.gradeGames >= Math.min(minGames, f.games) && f.gradeGames > 0 && UNIT_OF[f.line.position])
    .map((f) => ({ f, unit: UNIT_OF[f.line.position], avg: f.gradeSum / f.gradeGames }))
    .filter((x) => weeks === 1 || x.f.gradeGames >= minGames)
    .sort((a, b) => b.avg - a.avg);

  const takenUnits = new Set<UnitKey>();
  const chosen: typeof eligible = [];
  for (const x of eligible) {
    if (chosen.length >= MAX_MENTIONS) break;
    if (takenUnits.has(x.unit) || x.avg < MENTION_BAR) continue;
    takenUnits.add(x.unit);
    chosen.push(x);
  }
  for (const x of eligible) {
    if (chosen.length >= MAX_MENTIONS) break;
    if (chosen.includes(x) || x.avg < SECOND_FROM_UNIT_BAR) continue;
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
      clause: praise(f, avg, weeks, rng),
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
];
const VOICE_BIG = [
  "That's a day's work.",
  'He answered.',
  "We'll take that every week.",
  "That's why he is out there.",
];
const VOICE_SOLID = [
  'Did his job.',
  'Nothing loud about it. It counted.',
  'Steady.',
  'He gave us what we needed.',
];

/** The specific thing he did, named. Falls back to the whole line. */
function headlinePhrase(f: Folded, weeks: number): string {
  const s = f.stats as Record<string, number | undefined>;
  const pos = f.line.position;
  const over = weeks > 1 ? ` over ${f.games} game${f.games === 1 ? '' : 's'}` : '';

  if (pos === 'QB') {
    if ((s.passTd ?? 0) >= 3) return `${s.passTd} touchdown throws${over}.`;
    if ((s.passYds ?? 0) > 0) return `${s.passYds} through the air${over}, ${s.passTd ?? 0} of them scores.`;
  }
  if (pos === 'RB') {
    if ((s.rushTd ?? 0) >= 2) return `${s.rushTd} on the ground${over}.`;
    if ((s.rushYds ?? 0) > 0) return `${s.rushYds} rushing on ${s.rushAtt ?? 0} carries${over}.`;
  }
  if (pos === 'WR' || pos === 'TE') {
    if ((s.recTd ?? 0) >= 2) return `${s.recTd} in the end zone${over}.`;
    if ((s.recYds ?? 0) > 0) return `${s.recYds} receiving on ${s.rec ?? 0} catches${over}.`;
  }
  if (pos === 'EDGE' || pos === 'DT') {
    if ((s.sacks ?? 0) > 0) return `${s.sacks} sack${(s.sacks ?? 0) === 1 ? '' : 's'}${over}.`;
    return `${s.tackles ?? 0} tackles${over}.`;
  }
  if (pos === 'LB' || pos === 'CB' || pos === 'S') {
    if ((s.defInt ?? 0) > 0) return `${s.defInt} interception${(s.defInt ?? 0) === 1 ? '' : 's'}${over}.`;
    if ((s.ff ?? 0) > 0) return `${s.ff} forced fumble${(s.ff ?? 0) === 1 ? '' : 's'}${over}.`;
    if ((s.pd ?? 0) >= 2) return `${s.pd} balls broken up${over}.`;
    return `${s.tackles ?? 0} tackles${over}.`;
  }
  if (pos === 'K') return `${s.fgm ?? 0} of ${s.fga ?? 0} from the field${over}.`;
  return statLine(pos, f.stats) + '.';
}

function praise(f: Folded, grade: number, weeks: number, rng: Rng): string {
  const pool = grade >= 95 ? VOICE_HUGE : grade >= 88 ? VOICE_BIG : VOICE_SOLID;
  return `${headlinePhrase(f, weeks)} ${rng.pick(pool)}`;
}

/**
 * The careful half. A player appears here ONLY for something that measurably
 * cost the team, on a workload big enough for the rate to mean anything —
 * never for a quiet game, and never for a bench player's four snaps. See
 * findConcerns() in lib/gamePerformance.ts for every gate.
 *
 * One row per man, however many things went wrong. Three separate lines about
 * the same quarterback is a pile-on, not a report.
 */
function pickConcerns(folded: Map<string, Folded>, weeks: number, rng: Rng): ConcernRow[] {
  const rows = [...folded.values()]
    .map((f) => ({ f, list: findConcerns(f.line.position, f.stats, f.games) }))
    .filter((x) => x.list.length > 0)
    .map((x) => ({ ...x, worst: Math.max(...x.list.map((c) => c.severity)) }))
    .sort((a, b) => b.worst - a.worst)
    .slice(0, 2);

  return rows.map(({ f, list, worst }) => {
    const facts = list.sort((a, b) => b.severity - a.severity).slice(0, 2).map((c) => c.fact);
    const tail = worst >= 80
      ? rng.pick(['That is where the game went.', 'We cannot win giving it away like that.', 'That has to be cleaned up.'])
      : rng.pick(['Not good enough.', 'We need more than that.', 'That is on him and on us.']);
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

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "once" / "twice" / "five times". A coach does not say "1 times". */
function times(n: number): string {
  return n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;
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

function buildNotes(payloads: CoachPayload[], folded: Map<string, Folded>, weeks: number): string[] {
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
            : `${t.turnovers} giveaway${t.turnovers === 1 ? '' : 's'} each. Even in that column.`,
      );
    }
    if (t.sacksFor > 0 || t.sacksAgainst > 0) {
      notes.push(`The front got home ${times(t.sacksFor)}; they got to our passer ${t.sacksAgainst} time${t.sacksAgainst === 1 ? '' : 's'}.`);
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

  // Who is not available next week. This is the line that changes a lineup.
  const hurt = payloads.flatMap((p) => p.injuries);
  for (const i of hurt.slice(0, 2)) {
    notes.push(`${i.name}${i.position ? ` (${i.position})` : ''} — ${i.type.toLowerCase()}, out ${i.weeks} week${i.weeks === 1 ? '' : 's'}. Next man up.`);
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

  const record = payloads.reduce(
    (a, p) => ({ w: a.w + (p.outcome === 'W' ? 1 : 0), l: a.l + (p.outcome === 'L' ? 1 : 0), t: a.t + (p.outcome === 'T' ? 1 : 0) }),
    { w: 0, l: 0, t: 0 },
  );
  out.unshift(`${record.w}-${record.l}${record.t ? `-${record.t}` : ''} over the stretch.`);
  return out;
}

function buildOpener(payloads: CoachPayload[], weeks: number, rng: Rng): string {
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
    ? rng.pick(['Here is what stood up.', 'Here is what travelled.', 'Here is what I liked.'])
    : rng.pick(['Here is what has to change.', 'Here is where it went.', 'Here is the honest read.']);
  return `${head} ${tail}`;
}

export function buildCoachModel(payloadsIn: (CoachPayload | null | undefined)[]): CoachModel | null {
  const payloads = payloadsIn.filter((p): p is CoachPayload => !!p);
  if (payloads.length === 0) return null;
  const weeks = payloads.length;

  // Seeded on the span itself, so the same week re-renders to the same
  // sentences forever — including after a refresh, a resize, or a StrictMode
  // double render.
  const rng = new Rng(`coach:${payloads.map((p) => p.gameId ?? p.weekLabel).join('|')}`);

  const folded = fold(payloads);
  const top = pickTop(folded, weeks, rng);
  const concerns = pickConcerns(folded, weeks, rng);
  const t = sumTeam(payloads);

  return {
    weeks,
    opener: buildOpener(payloads, weeks, rng),
    topLabel: weeks > 1 ? 'Who carried the stretch' : 'Who showed up',
    top,
    topEmpty: top.length === 0
      ? `Nobody beat what is normal for his job${t ? ` — ${t.points} points on ${t.totalYards} yards` : ''}. That happens.`
      : null,
    concerns,
    concernsEmpty: concerns.length === 0 ? 'Nothing on the sheet worth calling out. Nobody gave it away.' : null,
    notes: buildNotes(payloads, folded, weeks),
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
            title={`Better than ${m.grade.toFixed(0)}% of games played at ${m.position} across every box score in the sim. ${UNIT_LABEL[m.unit]}.`}
          >
            TOP {Math.max(1, Math.round(100 - m.grade))}% AT {m.position}
          </span>
        </div>
        <p className="text-[13px] leading-snug text-chalk/85 mt-1">{m.clause}</p>
        <div className="font-mono text-[11px] text-muted mt-0.5">{m.line}</div>
      </div>
    </div>
  );
}
