const STAGES: { phase: string; label: string; desc: string }[] = [
  { phase: 'OFFSEASON', label: 'Housekeeping', desc: 'Rosters age, standings reset, contracts advance a year.' },
  { phase: 'RESIGN', label: 'Re-sign Window', desc: 'Decide which of your own expiring players to keep before they hit the market.' },
  { phase: 'FREE_AGENCY', label: 'Free Agency', desc: 'Sign from the league-wide pool — AI teams are bidding too.' },
  { phase: 'DRAFT', label: 'Rookie Draft', desc: "Draft this year's incoming class." },
  { phase: 'PRESEASON', label: 'New Season', desc: 'Back to football.' },
];

/**
 * The offseason is a chain of distinct League.phase values (not one big
 * "OFFSEASON" blob) — this just makes that chain visible, since the only
 * other signal was a single phase label in the header that didn't say what
 * came next or that a free agency / draft window existed at all.
 */
export function OffseasonRoadmap({ currentPhase }: { currentPhase: string }) {
  const currentIdx = STAGES.findIndex((s) => s.phase === currentPhase);
  if (currentIdx === -1) return null;

  return (
    <div className="card card-pad">
      <h2 className="font-semibold mb-3">Offseason Roadmap</h2>
      <div className="flex items-stretch gap-1.5">
        {STAGES.map((s, i) => {
          const state = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'upcoming';
          return (
            <div key={s.phase} className="flex-1 min-w-0">
              <div
                className={`h-1.5 rounded-full mb-2 ${
                  state === 'done' ? 'bg-accent' : state === 'current' ? 'bg-accent2' : 'bg-line'
                }`}
              />
              <div className={`text-xs font-semibold truncate ${state === 'current' ? 'text-accent2' : state === 'done' ? 'text-chalk' : 'text-muted'}`}>
                {s.label}
              </div>
              {state === 'current' && <div className="text-xs text-muted mt-0.5 leading-snug">{s.desc}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
