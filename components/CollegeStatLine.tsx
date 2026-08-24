import { CollegeGameLine, ncaaPasserRating } from '@/lib/gen/prospectProfile';
import { canonicalPosition } from '@/lib/tuning';

/**
 * Position-shaped college box score, aggregated to date — mirrors the position
 * groupings used to generate it.
 *
 * `position` arrives as a raw string off Player.position, which is a plain
 * text column and therefore still holds RETIRED positions in any save written
 * before they were retired — 48 fullbacks are sitting in the database right
 * now, 46 of them carrying a full 13-game college profile. Switching on the
 * raw string sent every one of them to the default branch, which says "No
 * college stats tracked for this position" over the top of thirteen games of
 * stats that are right there in the blob. canonicalPosition() is the alias
 * table lib/tuning.ts keeps for exactly this (FB -> RB: same group, same stat
 * line), so a retired position renders the line it always had instead of a
 * shrug. Live positions map to themselves, so nothing else changes.
 */
export function CollegeStatLine({ position, stats }: { position: string; stats: CollegeGameLine }) {
  const row = (label: string, value: string | number) => (
    <div className="flex justify-between border-b border-line/50 py-1">
      <span className="text-muted">{label}</span><span className="font-mono">{value}</span>
    </div>
  );

  switch (canonicalPosition(position)) {
    case 'QB': {
      const rating = ncaaPasserRating(stats.passCmp ?? 0, stats.passAtt ?? 0, stats.passYds ?? 0, stats.passTd ?? 0, stats.passInt ?? 0);
      return (
        <div className="grid grid-cols-2 gap-x-4 text-sm">
          {row('Comp/Att', `${stats.passCmp ?? 0}/${stats.passAtt ?? 0}`)}
          {row('Pass Yds', stats.passYds ?? 0)}
          {row('Pass TD', stats.passTd ?? 0)}
          {row('INT', stats.passInt ?? 0)}
          {row('Rush Yds', stats.rushYds ?? 0)}
          {row('Passer Rating', rating.toFixed(1))}
        </div>
      );
    }
    case 'RB':
      return (
        <div className="grid grid-cols-2 gap-x-4 text-sm">
          {row('Carries', stats.rushAtt ?? 0)}
          {row('Rush Yds', stats.rushYds ?? 0)}
          {row('Rush TD', stats.rushTd ?? 0)}
          {row('Receptions', stats.rec ?? 0)}
          {row('Rec Yds', stats.recYds ?? 0)}
        </div>
      );
    case 'WR': case 'TE':
      return (
        <div className="grid grid-cols-2 gap-x-4 text-sm">
          {row('Targets', stats.targets ?? 0)}
          {row('Receptions', stats.rec ?? 0)}
          {row('Rec Yds', stats.recYds ?? 0)}
          {row('Rec TD', stats.recTd ?? 0)}
        </div>
      );
    case 'LT': case 'LG': case 'C': case 'RG': case 'RT':
      return (
        <div className="grid grid-cols-2 gap-x-4 text-sm">
          {row('Sacks Allowed', stats.sacksAllowed ?? 0)}
          {row('Pancakes', stats.pancakes ?? 0)}
        </div>
      );
    case 'EDGE': case 'DT':
      return (
        <div className="grid grid-cols-2 gap-x-4 text-sm">
          {row('Tackles', stats.tkl ?? 0)}
          {row('Sacks', (stats.sacks ?? 0).toFixed(1))}
          {row('TFL', stats.tfl ?? 0)}
          {row('Forced Fum.', stats.ff ?? 0)}
        </div>
      );
    case 'LB':
      return (
        <div className="grid grid-cols-2 gap-x-4 text-sm">
          {row('Tackles', stats.tkl ?? 0)}
          {row('Sacks', (stats.sacks ?? 0).toFixed(1))}
          {row('TFL', stats.tfl ?? 0)}
          {row('INT', stats.ints ?? 0)}
        </div>
      );
    case 'CB': case 'S':
      return (
        <div className="grid grid-cols-2 gap-x-4 text-sm">
          {row('Tackles', stats.tkl ?? 0)}
          {row('INT', stats.ints ?? 0)}
          {row('Passes Def.', stats.pd ?? 0)}
          {row('Forced Fum.', stats.ff ?? 0)}
        </div>
      );
    case 'K':
      return (
        <div className="grid grid-cols-2 gap-x-4 text-sm">
          {row('FG Made/Att', `${stats.fgMade ?? 0}/${stats.fgAtt ?? 0}`)}
          {row('XP Made', stats.xpMade ?? 0)}
        </div>
      );
    case 'P':
      return (
        <div className="grid grid-cols-2 gap-x-4 text-sm">
          {row('Punts', stats.punts ?? 0)}
          {row('Yards', stats.puntYds ?? 0)}
          {row('Avg', stats.punts ? ((stats.puntYds ?? 0) / stats.punts).toFixed(1) : '0.0')}
        </div>
      );
    default:
      return <p className="text-sm text-muted">No college stats tracked for this position.</p>;
  }
}
