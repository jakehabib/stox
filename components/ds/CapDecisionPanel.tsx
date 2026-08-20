/**
 * The restructure tradeoff, made visually legible instead of two numbers
 * sitting side by side in a form. Space created now reads as a clear win
 * (accent green); the future cost reads as a clear cost (warn amber) — the
 * arrow between them is the whole point.
 */
export function CapDecisionPanel({ spaceNow, futureCost }: { spaceNow: string; futureCost: string }) {
  return (
    <div className="panel px-5 py-4 flex flex-col items-center gap-1 text-center">
      <div className="label-sm">Create Space Now</div>
      <div className="stat-value text-stat-lg text-accent">{spaceNow}</div>
      <div className="text-muted text-lg leading-none my-1">↓</div>
      <div className="stat-value text-stat-md text-warn">{futureCost}</div>
      <div className="label-sm">Added To Future Cap</div>
    </div>
  );
}
