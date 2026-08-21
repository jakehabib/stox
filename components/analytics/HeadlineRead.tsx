import Link from 'next/link';

export interface ReadLine {
  /** Two or three words naming what the sentence is about. */
  topic: string;
  /** The sentence a person would actually say out loud. */
  text: React.ReactNode;
}

/**
 * What the department would tell you if you only had thirty seconds.
 *
 * Every line is composed from figures the panels below compute — no line is
 * written unless the numbers behind it exist, and none of them is a threshold
 * invented here. The point is that a GM who reads nothing else leaves knowing
 * what happened to his club this season, in words rather than in axes.
 */
export function HeadlineRead({ lines, leagueId, teamName }: {
  lines: ReadLine[];
  leagueId: string;
  teamName: string;
}) {
  if (lines.length === 0) return null;
  return (
    <section className="card card-pad col-span-12">
      <div className="section-head items-end">
        <div className="min-w-0">
          <div className="label-sm text-[10px] tracking-[0.1em]">What the department would tell you</div>
          <h2 className="section-title text-[15px] mt-0.5">The Read On {teamName}</h2>
        </div>
        <Link href={`/league/${leagueId}/roster`} className="label-sm text-[10px] shrink-0 hover:text-chalk">
          Roster →
        </Link>
      </div>
      <ol className="mt-3 space-y-2.5">
        {lines.map((l, i) => (
          <li key={l.topic} className="flex gap-3 items-baseline">
            <span className="stat-value text-[15px] text-muted w-5 shrink-0 tabular-nums">{i + 1}</span>
            <span className="min-w-0">
              <span className="label-sm text-[9.5px] block mb-0.5">{l.topic}</span>
              <span className="text-sm leading-relaxed [&_b]:font-semibold [&_b]:text-chalk text-muted">{l.text}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
