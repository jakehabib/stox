import Link from 'next/link';
import { PlayerAvatar } from '../PlayerAvatar';
import type { SeasonReview as SeasonReviewModel, Story } from '@/lib/seasonReview';

/**
 * ===========================================================================
 * THE SEASON IN REVIEW — the panel
 * ===========================================================================
 * WHY IT IS A CARD OF ITS OWN, directly under the season announcement, rather
 * than inside it or behind a link.
 *
 * The announcement panel says of itself that it is "the RECORD, not the
 * event" — champion, your finish, the league's five awards. Every line in it
 * is a LEAGUE fact, and four of the five names on it usually belong to other
 * clubs. This is the opposite register: it is only ever about your own
 * players, it is prose rather than a grid, and it is the one thing on the
 * screen written in a voice. Folding it into that panel would make one very
 * tall tile that changes tone halfway down, and would push the awards grid
 * below several paragraphs of narrative that nobody has read yet.
 *
 * Behind a link on its own screen was the other option and it is worse.
 * README principle 0 wants the stories in the path the player already walks;
 * this fires once a year, on the one dashboard visit that is specifically
 * about the season being over, and a click is exactly how a once-a-year moment
 * gets missed forever. Coach's Comments earns its collapse by appearing
 * seventeen times a season on a screen people advance through — this appears
 * once, and it is the point of the visit.
 *
 * It renders on the server. There is no state, no interaction and no
 * measurement, so it ships no JavaScript at all.
 *
 * TWO SECTIONS, because they are in two tenses. The list is what the year DID
 * — the halves of a season against each other, a man against his own previous
 * best, what he was paid against what he produced. The short block under it is
 * what those men still ARE: how much is left between a rating and its ceiling,
 * and whether there is any. Development was invisible in this game before this
 * panel; a young player getting better and an old one finished getting better
 * are the two facts a dynasty is actually run on, and they do not belong in a
 * list of things that happened in September. Nobody appears in both.
 * ===========================================================================
 */

const TONE_DOT: Record<Story['tone'], string> = {
  good: 'bg-accent',
  bad: 'bg-bad',
  flat: 'bg-muted',
};

const POS_LABEL: Record<string, string> = {
  QB: 'quarterbacks', RB: 'running backs', WR: 'receivers', TE: 'tight ends',
  EDGE: 'edge rushers', DT: 'interior linemen', LB: 'linebackers',
  CB: 'corners', S: 'safeties', K: 'kickers',
};

/**
 * The standing badge. It reads TOP for a good year and BOTTOM for a poor one,
 * which sounds obvious and was not: printing "TOP 95%" over a bottom-5% season
 * is technically a true sentence and reads as praise, which is the opposite of
 * what the row beside it says.
 */
function standing(pct: number, position: string): { text: string; title: string } {
  const good = pct >= 50;
  const share = good ? Math.max(1, Math.round(100 - pct)) : Math.max(1, Math.round(pct));
  const group = POS_LABEL[position] ?? 'players';
  return {
    text: `${good ? 'TOP' : 'BOTTOM'} ${share}% AT ${position}`,
    title: `His year came out ahead of ${Math.round(pct)}% of full seasons at ${position}, measured against every season on record — not just this one. Weeks he did not play a real workload are left out.`,
  };
}

export function SeasonReview({ review, leagueId, teamColor }: {
  review: SeasonReviewModel;
  leagueId: string;
  teamColor?: string | null;
}) {
  const accent = teamColor ?? '#38bdf8';
  return (
    <div className="card card-pad space-y-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-lg font-semibold tracking-tight">The {review.seasonYear} season, player by player</h2>
      </div>

      <p
        className="text-[13.5px] leading-relaxed text-chalk/90 border-l-2 pl-3"
        style={{ borderColor: accent }}
      >
        {review.opener}
      </p>

      {review.quiet && <p className="text-[13px] text-muted">{review.quiet}</p>}

      {review.stories.length > 0 && (
        <div className="space-y-3.5">
          {review.stories.map((s) => (
            <StoryRow key={s.playerId} s={s} leagueId={leagueId} teamColor={teamColor} />
          ))}
        </div>
      )}

      {review.outlook.length > 0 && (
        <div className="pt-1">
          <h3 className="label-sm mb-2.5">Where they are headed</h3>
          <div className="space-y-3.5">
            {review.outlook.map((s) => (
              <StoryRow key={s.playerId} s={s} leagueId={leagueId} teamColor={teamColor} />
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

function StoryRow({ s, leagueId, teamColor }: { s: Story; leagueId: string; teamColor?: string | null }) {
  const badge = s.pct !== null ? standing(s.pct, s.position) : null;
  return (
    <div className="flex items-start gap-3">
      {/* Avatars stay — this section is full of players. README, design principles. */}
      <PlayerAvatar
        seed={s.playerId}
        age={s.age}
        size={38}
        teamColor={teamColor ?? undefined}
        weightLb={s.weightLb}
        heightIn={s.heightIn}
        position={s.position}
        className="shrink-0 mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 self-center ${TONE_DOT[s.tone]}`} aria-hidden="true" />
          <Link
            href={`/league/${leagueId}/player/${s.playerId}`}
            className="font-display font-bold text-[14px] leading-none hover:text-accent2 transition-colors"
          >
            {s.name}
          </Link>
          <span className="text-[10px] font-extrabold tracking-wider text-muted border border-line rounded px-1 py-px">
            {s.position}
          </span>
          {s.rookie && (
            <span className="text-[10px] font-extrabold tracking-wider text-accent2 border border-accent2/40 bg-accent2/10 rounded px-1 py-px">
              ROOKIE
            </span>
          )}
          {badge && (
            <span className="ml-auto font-mono text-[10px] text-muted shrink-0" title={badge.title}>
              {badge.text}
            </span>
          )}
        </div>
        <p className="text-[13px] leading-snug text-chalk/85 mt-1">{s.text}</p>
        <div className="font-mono text-[11px] text-muted mt-0.5">
          {/* Which half of the year the numbers under a line belong to is never
              left implicit — a postseason line and a regular-season one are not
              the same thing and must never be read as one. */}
          <span className="uppercase tracking-wider mr-1.5">
            {s.scope === 'PLAYOFFS' ? 'Postseason' : 'Regular season'} · {s.games}G
          </span>
          {s.line}
        </div>
      </div>
    </div>
  );
}
