import Link from 'next/link';
import { TeamLogo } from '../TeamLogo';

export interface BracketSide {
  teamId: string;
  abbr: string;
  city: string;
  seed: number | null;
  score: number | null;
  isUser: boolean;
  won: boolean;
}

export interface BracketGame {
  id: string;
  kind: string;
  played: boolean;
  home: BracketSide;
  away: BracketSide;
}

/** Rounds in the order they are played, with the label a broadcast would use. */
const ROUND_ORDER = ['WILDCARD', 'DIVISIONAL', 'CONFERENCE', 'FINAL'] as const;
const ROUND_LABEL: Record<string, string> = {
  WILDCARD: 'Wild Card',
  DIVISIONAL: 'Divisional',
  CONFERENCE: 'Conference Championship',
  FINAL: 'Championship',
};

/**
 * The postseason, drawn.
 *
 * There was no bracket anywhere in the app. Seeds appeared as small "#1"-"#6"
 * tags on the standings table and that was the entire postseason interface —
 * a player could learn more about a week 3 game than about their own
 * conference championship. Worse, the header read "Playoffs · Wk 1" for all
 * four rounds, so there was no way to tell which round was even being played.
 *
 * Rounds are laid out in the order they happen and label themselves, which is
 * what fixes the "which round is this" problem regardless of what the week
 * counter says.
 */
export function PlayoffBracket({ leagueId, games, seasonYear }: {
  leagueId: string;
  games: BracketGame[];
  seasonYear: number;
}) {
  if (games.length === 0) return null;

  const byRound = ROUND_ORDER
    .map((kind) => ({ kind, games: games.filter((g) => g.kind === kind) }))
    .filter((r) => r.games.length > 0);

  const champion = games.find((g) => g.kind === 'FINAL' && g.played);
  const winner = champion ? (champion.home.won ? champion.home : champion.away) : null;

  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-line/70 flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="label-sm">{seasonYear} Playoff Bracket</div>
          <div className="text-xs text-muted mt-0.5">
            {winner
              ? `${winner.city} are champions.`
              : `${byRound[byRound.length - 1] ? ROUND_LABEL[byRound[byRound.length - 1].kind] : ''} in progress.`}
          </div>
        </div>
        {winner && (
          <span className="pill border-gold/40 text-gold bg-gold/10">🏆 {winner.city}</span>
        )}
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-line/40">
        {byRound.map((round) => (
          <div key={round.kind}>
            <div className="px-3 py-2 border-b border-line/50 bg-ink/30">
              <span className="label-sm text-[10px]">{ROUND_LABEL[round.kind] ?? round.kind}</span>
            </div>
            <div className="divide-y divide-line/40">
              {round.games.map((g) => (
                <BracketMatch key={g.id} leagueId={leagueId} game={g} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BracketMatch({ leagueId, game }: { leagueId: string; game: BracketGame }) {
  const body = (
    <div className={`px-3 py-2.5 ${game.home.isUser || game.away.isUser ? 'bg-accent/[0.06]' : ''}`}>
      <BracketRow side={game.away} played={game.played} />
      <BracketRow side={game.home} played={game.played} />
      {!game.played && <div className="text-[10px] text-muted mt-1">Not yet played</div>}
    </div>
  );
  // Only a played game has a box score behind it.
  return game.played
    ? <Link href={`/league/${leagueId}/game/${game.id}`} className="block hover:bg-raised/40 transition-colors">{body}</Link>
    : body;
}

function BracketRow({ side, played }: { side: BracketSide; played: boolean }) {
  // A losing side is dimmed rather than struck through — four dimmed rows in
  // a column reads instantly as "these teams are out", where strikethrough on
  // a small dark row is close to invisible.
  const dim = played && !side.won;
  return (
    <div className={`flex items-center gap-2 py-0.5 ${dim ? 'opacity-45' : ''}`}>
      <span className="text-[10px] font-mono text-muted w-4 shrink-0">{side.seed ?? '—'}</span>
      <TeamLogo seed={side.teamId} abbr={side.abbr} size={18} />
      <span className={`text-sm flex-1 min-w-0 truncate ${side.won && played ? 'font-semibold' : ''}`}>
        {side.city}
      </span>
      {side.isUser && <span className="text-[9px] uppercase tracking-wider text-accent shrink-0">You</span>}
      {played && (
        <span className={`stat-value text-stat-sm shrink-0 ${side.won ? 'text-chalk' : 'text-muted'}`}>
          {side.score}
        </span>
      )}
    </div>
  );
}
