import { PlayerAvatar } from '../PlayerAvatar';
import { TeamLogo } from '../TeamLogo';
import { Tooltip } from '../Tooltip';
import { SectionHeading } from './SectionHeading';
import { RoundPicker } from '../draft/RoundPicker';
import { positionBadgeClass } from './positionColor';
import { ratingColor } from '@/lib/ratings';
import { tip } from '@/lib/glossary';

export interface RecapSelection {
  playerId: string;
  overall: number;
  round: number;
  firstName: string;
  lastName: string;
  position: string;
  college: string;
  heightIn: number;
  weightLb: number;
  /**
   * Drawn, never printed. The avatar is generated from build and age, so this
   * is here to keep a man's face the same one every other screen gives him.
   * It is his age NOW, not his age on draft night — a recap of a draft two
   * phases ago would be quoting a number that has since ticked over — so it
   * stays out of the table.
   */
  age: number;
  /**
   * WHAT WE ARE ALLOWED TO SAY ABOUT HIM, straight off buildScoutedView.
   *
   * `revealed` is exact-overall (he is on our roster, so there is nothing to
   * guess about); `potentialRevealed` is exact-ceiling, which is a separate
   * question and a stricter one. A man we drafted and have since traded or
   * cut comes back with neither, and renders as the ranges he really is to us.
   * Nothing in here may be printed without checking its own flag first.
   */
  ovr: number;
  ovrLow: number;
  ovrHigh: number;
  revealed: boolean;
  potLow: number;
  potHigh: number;
  potentialRevealed: boolean;
  /** The role our staff projects him into — drawn from the ceiling, not from what he is today. */
  projection?: { label: string; className: string };
  /** The public board's read on him, as it stood over the whole class. */
  boardRank?: number;
  boardGrade?: number;
  bandLabel?: string;
  /**
   * Our own read expressed on the board's scale (ownGradeFor), so the two
   * numbers are actually comparable. Absent unless we can see him exactly —
   * a grade built out of a range would be a guess wearing a decimal point.
   */
  ourGrade?: number;
  /**
   * One line on why the two grades sit where they sit — our own disagreement
   * with the room where we have one, the room's own reasoning where we do not.
   * The same sentence, from the same function, that his row on the big board
   * carried the night he was taken.
   */
  note?: string;
  /** The club whose pick this originally was, when it wasn't yours. */
  from?: { teamId: string; abbr: string };
}

export interface RecapLeaguePick {
  overall: number;
  round: number;
  teamId: string;
  teamAbbr: string;
  isUser: boolean;
  firstName: string;
  lastName: string;
  position: string;
  college: string;
  boardRank?: number;
  boardGrade?: number;
  /**
   * OUR scouted overall on another club's rookie — a range, always, and
   * present only where the department wrote a real file on him. Everyone else
   * carries the public grade and nothing more, which is the honest answer:
   * we never saw him.
   */
  ourFile?: { low: number; high: number };
  /** He was starred on our board and somebody else called his name. */
  shortlisted?: boolean;
}

/** One fact about how the room went. Never a verdict on whether a pick worked. */
export interface RecapNote {
  label: string;
  value: string;
  detail?: string;
  /** This one is about the user's own club — worth the accent. */
  isUser?: boolean;
}

/**
 * WHAT THE ROOM ACTUALLY DID.
 *
 * The draft used to end with the board simply emptying out. This is the
 * event's own record: the club's class with the numbers we now actually have
 * on it, every other name called with the grade the room had on him, and the
 * handful of things that were true on the night.
 *
 * THE ONE LINE THAT MATTERS HERE. The men in Your Class are OURS now — they
 * signed, they are in the building, and their ratings are exact on this panel
 * for the same reason they are exact on the roster page. Everybody else's
 * rookie stays behind our scouts: a public board grade, and our own range only
 * where we paid for one. A true overall on another club's pick would be the
 * worst number this page could print, so every rating below is gated on the
 * flag buildScoutedView returned rather than on anything read off the record.
 *
 * What is still deliberately absent is a verdict. Nothing here grades a class
 * against a career that has not been played yet, because in April nobody
 * knows — the closest it comes is setting our own grade beside the room's,
 * which is a disagreement, not a result. The game already has a place where
 * the result gets told: the years these men are about to have.
 */
export function DraftRecap({ year, teamAbbr, teamId, selections, roundOne, later, notes }: {
  year: number;
  teamAbbr: string;
  teamId: string;
  selections: RecapSelection[];
  roundOne: RecapLeaguePick[];
  /** Everything after round one, in pick order. Read a round at a time — this is 190-odd rows. */
  later: RecapLeaguePick[];
  notes: RecapNote[];
}) {
  // Round one is 32 rows against a class table of seven, so it runs in
  // columns underneath rather than in a lane beside it — which left half the
  // panel as empty floor.
  const half = Math.ceil(roundOne.length / 2);
  const columns = roundOne.length > 12 ? [roundOne.slice(0, half), roundOne.slice(half)] : [roundOne];

  // Rounds two and on, one group per round. 192 rows laid out flat is a
  // document and this panel was built specifically to stop being one — but the
  // cure was a capped box holding two lanes that scrolled together, rounds 2-4
  // on the left and 5-7 on the right, which answers "what happened after round
  // one" and refuses to answer "who went in round four". A round is a tab now
  // (see RoundPicker): one at a time, all of it on screen, same height either
  // way.
  const laterRounds: { round: number; picks: RecapLeaguePick[] }[] = [];
  for (const p of later) {
    const last = laterRounds[laterRounds.length - 1];
    if (last && last.round === p.round) last.picks.push(p);
    else laterRounds.push({ round: p.round, picks: [p] });
  }

  return (
    <div className="section">
      <SectionHeading
        eyebrow={`${year} Rookie Draft`}
        title="Draft Recap"
        action={
          <span className="text-xs text-muted">
            {selections.length} selection{selections.length === 1 ? '' : 's'} by {teamAbbr} · {roundOne.length + later.length} league-wide
          </span>
        }
      />

      {notes.length > 0 && (
        <div className="panel grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 divide-x divide-line/40">
          {notes.map((n) => (
            <div key={n.label} className="px-4 py-3">
              <div className={`label-sm ${n.isUser ? 'text-accent2' : ''}`}>{n.label}</div>
              <div className="text-sm font-semibold text-chalk mt-1 leading-tight">{n.value}</div>
              {n.detail && <div className="text-[11px] text-muted mt-1">{n.detail}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="panel overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line/60">
          <TeamLogo seed={teamId} abbr={teamAbbr} size={20} />
          <h3 className="section-title">Your Class</h3>
          <span className="text-[11px] text-muted ml-auto">
            They are in the building now — these are their real numbers, not a projection off a scouting report.
          </span>
        </div>
        {selections.length === 0 ? (
          <p className="text-sm text-muted px-4 py-3">No selections — every pick was traded away.</p>
        ) : (
          <table className="table-clean">
            <thead>
              <tr>
                <th>Pick</th>
                <th>Player</th>
                <th>Ovr</th>
                <th className="whitespace-nowrap">
                  Ceiling <Tooltip text={tip('potential')} />
                </th>
                <th>Board</th>
                <th className="whitespace-nowrap">
                  The Room <Tooltip text={tip('boardGrade')} />
                </th>
                <th>Our Grade</th>
                {/* The column that soaks up the slack. Without one the numbers
                    spread themselves across the whole panel and drift a foot
                    apart from the names they belong to — so rather than leave
                    it as empty floor it carries the sentence explaining why the
                    two grades to its left disagree. */}
                <th className="w-full">The Read</th>
              </tr>
            </thead>
            <tbody>
              {selections.map((s) => {
                const growth = s.revealed && s.potentialRevealed ? s.potLow - s.ovr : null;
                const gap = s.ourGrade !== undefined && s.boardGrade !== undefined ? s.boardGrade - s.ourGrade : null;
                return (
                  <tr key={s.playerId}>
                    <td className="whitespace-nowrap">
                      <span className="stat-value text-stat-sm text-chalk">#{s.overall}</span>
                      <span className="text-[11px] text-muted font-mono ml-1.5">R{s.round}</span>
                      {s.from && (
                        <span className="flex items-center gap-1 mt-0.5" title={`Acquired from ${s.from.abbr}`}>
                          <TeamLogo seed={s.from.teamId} abbr={s.from.abbr} size={14} />
                          <span className="text-[10px] text-accent2">from {s.from.abbr}</span>
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {/* Name then college, the same shape his row on the big
                          board had, so the two read as the same man. */}
                      <div className="flex items-center gap-2">
                        <PlayerAvatar seed={s.playerId} age={s.age} size={26} weightLb={s.weightLb} heightIn={s.heightIn} position={s.position} />
                        <span className={`font-semibold text-xs ${positionBadgeClass(s.position)}`}>{s.position}</span>
                        <span className="font-medium">{s.firstName} {s.lastName}</span>
                        <span className="text-xs text-muted">{s.college}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap">
                      {s.revealed ? (
                        <span className={`stat-value text-stat-sm ${ratingColor(s.ovr)}`}>{s.ovr}</span>
                      ) : (
                        <span className="font-mono text-sm text-muted">{s.ovrLow}–{s.ovrHigh}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {/* A rookie's overall today says almost nothing. The
                          ceiling is the reason he was taken, so it is stated at
                          the same weight as the overall beside it — and where
                          he is no longer ours it stays the range it really is. */}
                      {s.potentialRevealed ? (
                        <>
                          <span className={`stat-value text-stat-sm ${ratingColor(s.potLow)}`}>{s.potLow}</span>
                          {growth !== null && growth > 0 && (
                            <span className="text-[10px] text-muted ml-1.5">+{growth} to grow</span>
                          )}
                        </>
                      ) : (
                        <span className="font-mono text-sm text-muted">{s.potLow}–{s.potHigh}</span>
                      )}
                      {s.projection && (
                        <div className={`text-[10px] mt-0.5 ${s.projection.className}`}>{s.projection.label}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {s.boardRank !== undefined ? (
                        <>
                          <span className="font-mono text-sm text-chalk">#{s.boardRank}</span>
                          <span className="text-[10px] text-muted ml-1.5">{boardGap(s.boardRank, s.overall)}</span>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {s.boardGrade !== undefined && <span className="stat-value text-stat-sm text-chalk">{s.boardGrade}</span>}
                      {s.bandLabel && <span className="text-[10px] text-muted ml-1.5">{s.bandLabel}</span>}
                    </td>
                    <td className="whitespace-nowrap">
                      {s.ourGrade !== undefined ? (
                        <>
                          <span className="stat-value text-stat-sm text-chalk">{s.ourGrade}</span>
                          {gap !== null && Math.abs(gap) >= 3 && (
                            <div className={`text-[10px] mt-0.5 ${gap > 0 ? 'text-warn' : 'text-accent'}`}>
                              {gap > 0 ? `room was ${gap} high` : `room was ${-gap} low`}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="text-[11px] text-muted leading-snug max-w-[26rem] whitespace-normal">{s.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel overflow-hidden">
        <div className="flex items-baseline gap-3 px-4 py-2.5 border-b border-line/60">
          <h3 className="section-title">Round One</h3>
          <span className="text-[11px] text-muted ml-auto">
            Every other club&rsquo;s rookie carries the room&rsquo;s grade — ours is only there where we scouted him.
          </span>
        </div>
        <div className="grid md:grid-cols-2 md:divide-x divide-line/40">
          {columns.map((col, i) => (
            <div key={i} className="divide-y divide-line/40">
              {col.map((p) => <LeaguePickRow key={p.overall} pick={p} />)}
            </div>
          ))}
          {roundOne.length === 0 && <p className="text-sm text-muted px-4 py-3">No selections recorded.</p>}
        </div>
      </div>

      {later.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="flex items-baseline gap-3 px-4 py-2.5 border-b border-line/60">
            <h3 className="section-title">
              The Rest Of The Board
            </h3>
            <span className="text-[11px] text-muted">
              rounds {laterRounds[0]?.round ?? 2}–{laterRounds[laterRounds.length - 1]?.round ?? 2}
            </span>
            <span className="text-[11px] text-muted ml-auto">{later.length} selections</span>
          </div>
          <RoundPicker
            rounds={laterRounds.map((g) => {
              // Same two-column split round one uses, for the same reason: a
              // single lane of 32 names is twice as tall as it needs to be.
              const cut = Math.ceil(g.picks.length / 2);
              return {
                round: g.round,
                body: (
                  <div className="grid md:grid-cols-2 md:divide-x divide-line/40">
                    {[g.picks.slice(0, cut), g.picks.slice(cut)].map((col, i) => (
                      <div key={i} className="divide-y divide-line/40">
                        {col.map((p) => <LeaguePickRow key={p.overall} pick={p} />)}
                      </div>
                    ))}
                  </div>
                ),
              };
            })}
          />
        </div>
      )}
    </div>
  );
}

/**
 * One name off the board, anybody's. The rating on this row is the PUBLIC
 * grade and is labelled as one — it is what the room thought he was worth, not
 * what he is, and the two are different numbers by design (lib/consensus.ts).
 * Our own scouted range rides alongside it only when the department actually
 * filed on him, because a range quoted off the baseline report every prospect
 * carries would be the same eleven points on every row in the league.
 */
function LeaguePickRow({ pick: p }: { pick: RecapLeaguePick }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 ${p.isUser ? 'bg-accent2/10' : ''}`}>
      <span className="w-7 shrink-0 text-right font-mono text-[11px] text-muted">{p.overall}</span>
      <TeamLogo seed={p.teamId} abbr={p.teamAbbr} size={18} />
      <span className="font-mono text-[11px] w-8 shrink-0">{p.teamAbbr}</span>
      <span className={`text-[10px] font-semibold w-9 shrink-0 ${positionBadgeClass(p.position)}`}>{p.position}</span>
      <span className="text-xs truncate flex-1 min-w-0">
        {p.shortlisted && <span className="text-gold mr-1" title="He was on our shortlist">★</span>}
        {p.firstName} {p.lastName}
        <span className="text-muted ml-1.5">{p.college}</span>
      </span>
      {p.ourFile && (
        <span className="text-[10px] text-accent2 font-mono shrink-0" title="Our own scouted range on him">
          ours {p.ourFile.low}–{p.ourFile.high}
        </span>
      )}
      {/* Labelled every time, and never colour-tiered. A bare number in this
          position would be read as an overall by everybody who has ever seen a
          roster table — and it is not one, it is what the room thought he was
          worth. The word is what keeps it from lying.

          The `leading-none` pair is not decoration either. Tailwind's text-*
          utilities ship a line-height with the size and win against
          .stat-value's own, so `text-base` alone gives this number a 24px line
          box inside a 16px row — and at 224 rows that stray leading is a
          screenful of nothing. */}
      {p.boardGrade !== undefined && (
        <span className="shrink-0 text-right text-[10px] leading-none">
          <span className="text-[10px] text-muted mr-1">grade</span>
          <span className="stat-value text-base leading-none text-chalk">{p.boardGrade}</span>
        </span>
      )}
      {p.boardRank !== undefined && (
        <span className="text-[10px] text-muted font-mono shrink-0 w-16 text-right">
          board #{p.boardRank}
        </span>
      )}
    </div>
  );
}

/**
 * Where he went against where the board had him. A fact about the night, not
 * a judgement: "early" here means the room valued him above the consensus,
 * which is a thing clubs do on purpose and are sometimes right about.
 */
function boardGap(boardRank: number, overall: number): string {
  if (boardRank === overall) return 'on the board';
  return boardRank > overall ? `${boardRank - overall} early` : `${overall - boardRank} late`;
}
