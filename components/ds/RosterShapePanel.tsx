import type { RosterShape, GroupShape } from '@/lib/rosterShape';
import type { TeamRating } from '@/lib/teamRating';

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

const GROUP_LABEL: Record<string, string> = {
  QB: 'QB', RB: 'Backfield', WR: 'Receivers', TE: 'Tight Ends', OL: 'O-Line',
  DL: 'D-Line', LB: 'Linebacker', DB: 'Secondary', ST: 'Specialists',
};

/**
 * Deltas are small numbers with a sign that matters, so the bar is centred on
 * zero and grows either way rather than filling left to right — a half-full
 * bar would read as "middling" when it means "three points clear of the
 * league."
 */
function DeltaBar({ delta }: { delta: number }) {
  // ±8 rating points covers essentially every real gap; beyond that the bar
  // just pins rather than rescaling everything else into invisibility.
  const pct = Math.min(Math.abs(delta) / 8, 1) * 50;
  const positive = delta >= 0;
  return (
    <div className="relative h-1.5 bg-raised rounded-full overflow-hidden">
      <div className="absolute inset-y-0 left-1/2 w-px bg-line" />
      <div
        className={`absolute inset-y-0 ${positive ? 'bg-accent' : 'bg-bad'}`}
        style={positive ? { left: '50%', width: `${pct}%` } : { right: '50%', width: `${pct}%` }}
      />
    </div>
  );
}

function GroupTile({ g, unitRank }: { g: GroupShape; unitRank?: number }) {
  if (g.count === 0) {
    return (
      <div className="px-3 py-2.5 opacity-50">
        <div className="label-sm text-[10px]">{GROUP_LABEL[g.group] ?? g.group}</div>
        <div className="stat-value text-stat-sm text-bad mt-1">—</div>
        <div className="text-[10px] text-muted mt-1">nobody rostered</div>
      </div>
    );
  }

  const strong = g.delta >= 2;
  const weak = g.delta <= -2;
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-1">
        <span className="label-sm text-[10px]">{GROUP_LABEL[g.group] ?? g.group}</span>
        {unitRank
          ? <span className={`text-[10px] font-mono ${unitRank <= 8 ? 'text-accent' : unitRank >= 25 ? 'text-bad' : 'text-muted'}`}>#{unitRank}</span>
          : <span className="text-[10px] text-muted">{g.count}</span>}
      </div>
      <div className="flex items-baseline gap-1.5 mt-1">
        <span className="stat-value text-stat-sm">{g.starterOvr.toFixed(0)}</span>
        <span className={`text-[11px] font-mono ${strong ? 'text-accent' : weak ? 'text-bad' : 'text-muted'}`}>
          {g.delta >= 0 ? '+' : ''}{g.delta.toFixed(1)}
        </span>
      </div>
      <div className="mt-1.5"><DeltaBar delta={g.delta} /></div>
      <div className="text-[10px] text-muted mt-1.5">
        {g.avgAge.toFixed(1)} yrs{g.expiring > 0 ? ` · ${g.expiring} expiring` : ''}
      </div>
    </div>
  );
}

/**
 * The team-assessment header the roster page was missing. A 53-row table
 * answers "who is on this team"; this answers "what kind of team is it" —
 * which unit is carrying it, which one is about to cost it a season, and
 * whether the core is aging out. Every rating is a delta against the league's
 * average starter at the same group, because a raw 78 is meaningless on its
 * own.
 */
export function RosterShapePanel({ shape, rating }: { shape: RosterShape; rating?: TeamRating }) {
  const { strongest, weakest } = shape;

  return (
    <div className="panel overflow-hidden">
      {rating && (
        <div className="px-4 py-3 border-b border-line/70 flex items-center gap-5 flex-wrap">
          {/* The headline number. A rating with no rank is far less useful —
              "77 overall" means nothing until you know it is 4th of 32. */}
          <div className="flex items-baseline gap-2.5">
            <span className="stat-value text-stat-xl leading-none">{rating.overall}</span>
            <div>
              <div className="label-sm">Team Overall</div>
              <div className={`text-xs mt-0.5 font-semibold ${rating.rank <= 8 ? 'text-accent' : rating.rank >= 25 ? 'text-bad' : 'text-muted'}`}>
                {ordinal(rating.rank)} of 32 · {ordinal(rating.confRank)} in the {rating.conference} · {ordinal(rating.divRank)} in the {rating.division}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 ml-auto">
            {[
              { label: 'Offense', value: rating.offense },
              { label: 'Defense', value: rating.defense },
              { label: 'Special Teams', value: rating.specialTeams },
            ].map((s) => (
              <div key={s.label}>
                <div className="label-sm text-[10px]">{s.label}</div>
                <div className="stat-value text-stat-sm mt-0.5">{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 py-3 border-b border-line/70 flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="label-sm">Roster Construction</div>
          <div className="text-xs text-muted mt-0.5">
            Starter rating at each unit, with its league rank, measured against the league average starter there.
          </div>
        </div>
        <div className="flex items-center gap-4 text-[11px]">
          {strongest && strongest.delta > 0 && (
            <span className="text-muted">
              Strength <span className="text-accent font-semibold">{GROUP_LABEL[strongest.group] ?? strongest.group}</span>
              <span className="font-mono text-accent"> +{strongest.delta.toFixed(1)}</span>
            </span>
          )}
          {weakest && weakest.delta < 0 && (
            <span className="text-muted">
              Weakness <span className="text-bad font-semibold">{GROUP_LABEL[weakest.group] ?? weakest.group}</span>
              <span className="font-mono text-bad"> {weakest.delta.toFixed(1)}</span>
            </span>
          )}
          {shape.over30 > 0 && (
            <span className="text-muted">
              <span className={shape.agingStarters > 2 ? 'text-warn font-semibold' : ''}>{shape.over30}</span> aged 30+
              {shape.agingStarters > 0 ? ` (${shape.agingStarters} starting)` : ''}
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 divide-x divide-y lg:divide-y-0 divide-line/40">
        {shape.groups.map((g) => (
          <GroupTile key={g.group} g={g} unitRank={rating?.units.find((u) => u.group === g.group)?.rank} />
        ))}
      </div>
    </div>
  );
}
