import { CollegeGameLine, ncaaPasserRating } from '@/lib/gen/prospectProfile';

/** Position-shaped college box score, aggregated to date — mirrors the position groupings used to generate it. */
export function CollegeStatLine({ position, stats }: { position: string; stats: CollegeGameLine }) {
  const row = (label: string, value: string | number) => (
    <div className="flex justify-between border-b border-line/50 py-1">
      <span className="text-muted">{label}</span><span className="font-mono">{value}</span>
    </div>
  );

  switch (position) {
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
    case 'RB': case 'FB':
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
