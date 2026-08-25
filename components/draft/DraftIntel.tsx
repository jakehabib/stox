import { positionBadgeClass } from '../ds/positionColor';
import { RosterNeeds } from '../ds/RosterNeeds';
import { Tooltip } from '../Tooltip';

// ---------------------------------------------------------------------------
// RUN WATCH
// ---------------------------------------------------------------------------

export interface RunEntry {
  position: string;
  /** Selections at this position inside the trailing window. */
  inWindow: number;
  /** One flag per selection in the window, oldest first — the shape of the run. */
  hits: boolean[];
  /** Gone at this position in the whole draft so far. */
  totalGone: number;
  /** Still on the board at this position with a day-two grade or better. */
  leftOnBoard: number;
  /** True when this is one of the holes this club came here to fill. */
  atOurNeed: boolean;
}

/**
 * THE SINGLE MOST USEFUL THING A GM LEARNS DURING A DRAFT.
 *
 * Six receivers in eleven picks is not trivia — it is the room telling you
 * that the eighth-best receiver is about to be taken at a first-round price
 * and the second-best guard is about to fall to you. Nothing said it before
 * this panel existed; you would have read twelve transaction headlines and
 * counted.
 *
 * A run only earns a line when it is a run (three at one position inside the
 * window). Below that the panel says the quiet thing outright rather than
 * dressing two receivers up as a trend, because a run detector that always
 * detects a run is a decoration.
 */
export function RunWatch({ entries, windowSize, order, complete = false }: {
  entries: RunEntry[];
  windowSize: number;
  /** The window's positions in the order they were called, oldest first. */
  order: string[];
  /** Every pick is in — there is no "left on the board" left to warn about. */
  complete?: boolean;
}) {
  const shown = entries.filter((e) => e.inWindow > 0).slice(0, 4);
  const lead = shown[0];
  const isRun = (lead?.inWindow ?? 0) >= 3;

  return (
    <div className="panel p-4 h-full">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="section-title">{complete ? 'How It Closed' : 'Run Watch'}</h2>
        <span className="text-[11px] font-mono text-muted">last {windowSize} selections</span>
      </div>

      {!lead ? (
        <p className="text-sm text-muted">Nothing has come off the board yet.</p>
      ) : (
        <div className="space-y-3">
          {/*
             THE RUN BEING CALLED. Keyed on the position, so the line arrives
             once when the pattern turns on and again only if the run moves to
             a different position — never on every pick, and never at all
             while the board is thinning evenly. A run detector that announces
             itself every five seconds is a decoration; this one speaks when
             there is something to say.
          */}
          <p key={isRun ? lead.position : 'quiet'} className={`text-sm text-chalk/85 ${isRun && !complete ? 'moment-called' : ''}`}>
            {complete ? (
              <>
                The draft closed on a {lead.position} run — {lead.inWindow} of the last {windowSize}{' '}
                names called. {lead.totalGone} came off the board there across the seven rounds.
              </>
            ) : isRun ? (
              <>
                {lead.inWindow} {lead.position}
                {lead.inWindow === 1 ? '' : 's'} in the last {windowSize}.{' '}
                {lead.leftOnBoard <= 2
                  ? `The board has ${lead.leftOnBoard === 0 ? 'nobody' : lead.leftOnBoard === 1 ? 'one man' : `${lead.leftOnBoard} men`} left there worth a day-two pick.`
                  : `${lead.leftOnBoard} left with a day-two grade or better.`}
                {lead.atOurNeed ? ' It is a hole we came here to fill.' : ''}
              </>
            ) : (
              <>
                No run on. The last {windowSize} selections have come off in ones and twos, so the board is
                thinning evenly and nobody is being forced into a reach.
              </>
            )}
          </p>

          {shown.map((r) => (
            <div key={r.position} className="flex items-center gap-3">
              <span className={`pill text-[11px] font-semibold w-12 justify-center shrink-0 ${positionBadgeClass(r.position)}`}>
                {r.position}
              </span>
              <div className="flex gap-[3px] shrink-0">
                {r.hits.map((hit, i) => (
                  <span
                    key={i}
                    className={`w-2 h-4 rounded-[2px] ${hit ? `${positionBadgeClass(r.position)} bg-current` : 'bg-line'}`}
                  />
                ))}
              </div>
              <span className="text-xs text-muted flex-1 text-right whitespace-nowrap">
                {complete ? (
                  <>{r.totalGone} taken</>
                ) : (
                  <>
                    {r.totalGone} gone ·{' '}
                    <span className={r.leftOnBoard <= 2 ? 'text-warn' : 'text-chalk'}>{r.leftOnBoard} left</span>
                  </>
                )}
              </span>
            </div>
          ))}

          {order.length > 0 && (
            <div className="pt-3 mt-1 border-t border-line/50">
              <div className="label-sm mb-2">In The Order They Went</div>
              <div className="flex flex-wrap gap-1">
                {order.map((pos, i) => (
                  <span
                    key={i}
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-raised/50 ${positionBadgeClass(pos)}`}
                  >
                    {pos}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OFF THE BOARD
// ---------------------------------------------------------------------------

export interface PositionStock {
  position: string;
  /** Taken from the board's top tier. */
  gone: number;
  /** Still there in the board's top tier. */
  left: number;
  atOurNeed: boolean;
}

/**
 * WHAT IS LEFT, BY POSITION — the answer to "should I reach for a tackle."
 *
 * The caller decides what pool is counted and says so in `tierLabel`. While a
 * draft is running that pool is the board's own day-two line, not the whole
 * class: the class always has forty tackles in it and that number answers
 * nothing, whereas two tackles left with a day-two grade and four rounds to go
 * is the fact that makes a GM take one early. Once every pick is in, that tier
 * is empty by definition and the caller widens the pool to the whole class —
 * which is the list priority free agency is about to be worked from.
 */
export function BoardDepletion({ stock, tierLabel }: { stock: PositionStock[]; tierLabel: string }) {
  const widest = Math.max(1, ...stock.map((s) => s.gone + s.left));

  return (
    <div className="panel p-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="section-title inline-flex items-center gap-2">
          Off The Board
          <Tooltip text="Where the board's early talent has gone, position by position. Counted against the public board's own grades, not the size of the class." />
        </h2>
        <span className="text-[11px] font-mono text-muted">{tierLabel}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        {stock.map((s) => {
          const total = s.gone + s.left;
          return (
            <div key={s.position} className="flex items-center gap-2.5">
              <span className={`text-[11px] font-semibold w-9 shrink-0 ${positionBadgeClass(s.position)}`}>
                {s.position}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-raised overflow-hidden flex" style={{ maxWidth: `${(total / widest) * 100}%` }}>
                <div className="h-full bg-line" style={{ width: `${(s.gone / Math.max(1, total)) * 100}%` }} />
                <div className={`h-full ${s.left === 0 ? 'bg-bad' : s.left <= 2 ? 'bg-warn' : 'bg-accent2'}`} style={{ width: `${(s.left / Math.max(1, total)) * 100}%` }} />
              </div>
              <span className="text-[11px] font-mono w-14 text-right shrink-0">
                <span className={s.left === 0 ? 'text-bad' : s.left <= 2 ? 'text-warn' : 'text-chalk'}>{s.left}</span>
                <span className="text-muted"> left</span>
              </span>
              <span className={`w-3 shrink-0 text-[11px] ${s.atOurNeed ? 'text-bad' : 'text-transparent'}`} title={s.atOurNeed ? 'A hole on our roster' : undefined}>
                ●
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted mt-3 pt-2.5 border-t border-line/50">
        <span className="text-bad">●</span> marks a position this roster still needs.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// THE WAR ROOM
// ---------------------------------------------------------------------------

export interface WarRoomPick { round: number; overall: number; picksAway?: number; spentOn?: string }

/**
 * The club's own side of the room: what it still has to spend, what it came
 * here to fix, and how much of this class it actually has a read on. Three
 * numbers a GM checks between picks and nothing he does not.
 */
export function WarRoomPanel({ picks, needs, filed, classSize, shortlistLeft }: {
  picks: WarRoomPick[];
  needs: Array<{ position: string; value: number; label: string; className: string }>;
  /** Prospects in this class our department has a real file on. */
  filed: number;
  classSize: number;
  /** Starred men still on the board. */
  shortlistLeft: number;
}) {
  const unused = picks.filter((p) => !p.spentOn);

  return (
    <div className="panel p-4 space-y-4 h-full">
      <div>
        <div className="flex items-baseline justify-between gap-3 mb-2.5">
          <h2 className="section-title">The War Room</h2>
          <span className="text-[11px] font-mono text-muted">
            {unused.length} pick{unused.length === 1 ? '' : 's'} left
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {picks.map((p) => (
            <span
              key={p.overall}
              title={p.spentOn ? `Spent on ${p.spentOn}` : undefined}
              className={`pill text-[11px] font-mono ${
                p.spentOn
                  ? 'border-line/50 text-muted/60 bg-raised/40'
                  : p.picksAway === 0
                    ? 'border-accent text-accent bg-accent/10'
                    : 'border-gold/50 text-gold bg-gold/5'
              }`}
            >
              R{p.round} · #{p.overall}
            </span>
          ))}
          {picks.length === 0 && <span className="text-xs text-muted">No selections in this draft.</span>}
        </div>
      </div>

      {needs.length > 0 && (
        <div>
          <div className="label-sm mb-2.5">What We Came Here To Fix</div>
          <RosterNeeds needs={needs} />
        </div>
      )}

      <div className="pt-3 border-t border-line/50 grid grid-cols-2 gap-4">
        <div>
          <div className="label-sm">Files On This Class</div>
          <div className={`stat-value text-stat-sm leading-none mt-1.5 ${filed === 0 ? 'text-warn' : ''}`}>{filed}</div>
          <div className="text-[11px] text-muted mt-1.5">of {classSize} prospects</div>
        </div>
        <div>
          <div className="label-sm">Shortlist Still There</div>
          <div className={`stat-value text-stat-sm leading-none mt-1.5 ${shortlistLeft > 0 ? 'text-gold' : 'text-muted'}`}>
            {shortlistLeft}
          </div>
          <div className="text-[11px] text-muted mt-1.5">starred and undrafted</div>
        </div>
      </div>
    </div>
  );
}
