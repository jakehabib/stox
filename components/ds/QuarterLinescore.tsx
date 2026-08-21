import { TeamLogo } from '../TeamLogo';

/**
 * The four-quarter linescore — the single most standard object in sports
 * presentation, stored by this sim for every game it has ever played
 * (`BoxScore.quarters`) and, until now, never rendered anywhere.
 *
 * Overtime honesty: the engine folds sudden-death points into the fourth
 * quarter (lib/sim/engine.ts:192) rather than keeping a separate OT column,
 * so when a game went past regulation this says so in words instead of
 * inventing a column the data does not have.
 */
export function QuarterLinescore({ away, home, quarters, overtime }: {
  away: { teamId: string; abbr: string; score: number };
  home: { teamId: string; abbr: string; score: number };
  quarters: { home: number[]; away: number[] };
  overtime?: boolean;
}) {
  const n = Math.max(quarters.home.length, quarters.away.length, 4);
  const cols = Array.from({ length: n }, (_, i) => `Q${i + 1}`);

  const Row = ({ side, won }: { side: { teamId: string; abbr: string; score: number }; won: boolean }) => {
    const line = side === away ? quarters.away : quarters.home;
    return (
      <tr className="border-t border-line/50">
        <td className="py-2 pr-3">
          <span className="flex items-center gap-2">
            <TeamLogo seed={side.teamId} abbr={side.abbr} size={22} className="shrink-0" />
            <span className="font-display font-bold uppercase tracking-wide text-sm">{side.abbr}</span>
          </span>
        </td>
        {cols.map((_, i) => (
          <td key={i} className="py-2 px-2 text-center font-mono text-sm text-muted tabular-nums">
            {line[i] ?? 0}
          </td>
        ))}
        <td className={`py-2 pl-3 text-right stat-value text-stat-sm ${won ? 'text-accent' : 'text-muted'}`}>
          {side.score}
        </td>
      </tr>
    );
  };

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="label-sm text-left pb-1">Linescore</th>
              {cols.map((c) => <th key={c} className="label-sm px-2 pb-1 text-center">{c}</th>)}
              <th className="label-sm pb-1 text-right">T</th>
            </tr>
          </thead>
          <tbody>
            <Row side={away} won={away.score > home.score} />
            <Row side={home} won={home.score > away.score} />
          </tbody>
        </table>
      </div>
      {overtime && (
        <p className="text-[11px] text-muted mt-2">
          Went to overtime — the sim records sudden-death points inside Q4, so there is no separate OT column.
        </p>
      )}
    </div>
  );
}
