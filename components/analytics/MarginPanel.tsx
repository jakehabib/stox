import { MarginGame, MarginProfile, BLOWN_LEAD_MARGIN } from '@/lib/analytics';
import { Panel, Legend, Note, NotOnRecord, Tiles, Tile, SubHead, TableTwin, ChartBox } from './Panel';
import { VIZ, TXT, signed, ordinal } from './viz';

/**
 * Panel 4 — every final margin, and the shape the drive log says produced it.
 *
 * The archetypes come from computeGameShape(), which reads the drive-by-drive
 * log already stored in each box score. So "Collapse" here is the same reading
 * the recap on the game page gives; it is not a second classification invented
 * for this screen.
 */
export function MarginPanel({ games, profile, thresholds, teamRatingRank, seasonYear, playoffGamesExcluded, seasonLabel }: {
  games: MarginGame[];
  profile: MarginProfile;
  thresholds: { oneScore: number; blowout: number };
  teamRatingRank: number;
  seasonYear: number;
  /** Postseason games deliberately left out of a regular-season panel. */
  playoffGamesExcluded: number;
  seasonLabel: string;
}) {
  const oneScoreTotal = profile.oneScoreWins + profile.oneScoreLosses;
  const noArchetype = profile.shapes.find((s) => s.archetype === 'Not on record');

  return (
    <Panel
      span={7}
      eyebrow={`Every final margin · ${seasonLabel}`}
      title="How These Games Are Actually Being Decided"
      flag={games.length === 0 ? undefined : {
        text: `${profile.oneScoreWins}-${profile.oneScoreLosses} in one-score games`,
        tone: profile.oneScoreWins > profile.oneScoreLosses ? 'good' : profile.oneScoreWins < profile.oneScoreLosses ? 'bad' : 'warn',
      }}
      why={<>
        Signed margin per game, with hairlines at ±{thresholds.oneScore} (one score) and ±{thresholds.blowout} (a
        game decided early). Reconstructed from the drives already stored in each box score, so the archetype on a
        game is the same reading the recap gives you.
      </>}
    >
      {games.length === 0 ? (
        <p className="text-sm text-muted py-6">
          No {seasonLabel.toLowerCase()} game has been played in {seasonYear} yet. This panel fills in from week one.
        </p>
      ) : (
        <>
          <ChartBox><MarginChart games={games} thresholds={thresholds} /></ChartBox>
          <Legend
            keys={[{ color: VIZ.good, label: 'Win', shape: 'block' }, { color: VIZ.bad, label: 'Loss', shape: 'block' }]}
            note={`Rules at ±${thresholds.oneScore} (one score) and ±${thresholds.blowout} (blowout)`}
          />

          <Tiles cols={4}>
            <Tile
              label="One-score games"
              value={`${profile.oneScoreWins}-${profile.oneScoreLosses}`}
              detail={`${Math.round((100 * oneScoreTotal) / games.length)}% of the schedule so far`}
              tone={profile.oneScoreLosses > profile.oneScoreWins ? 'bad' : profile.oneScoreWins > profile.oneScoreLosses ? 'good' : undefined}
            />
            <Tile
              label="Blowouts"
              value={`${profile.blowoutWins}-${profile.blowoutLosses}`}
              detail={profile.blowoutWins + profile.blowoutLosses === 0 ? 'nothing has been decided early' : `at ±${thresholds.blowout} or more`}
            />
            <Tile
              label="Average margin"
              value={signed(profile.averageMargin)}
              detail="points a game, net"
              tone={profile.averageMargin > 0 ? 'good' : profile.averageMargin < 0 ? 'bad' : undefined}
            />
            <Tile
              label={`Leads of ${BLOWN_LEAD_MARGIN}+ lost`}
              value={String(profile.blownLeads.length)}
              detail={profile.blownLeads.length ? profile.blownLeads.map((g) => g.oppAbbr).join(', ') : 'none surrendered'}
              tone={profile.blownLeads.length > 0 ? 'bad' : undefined}
            />
          </Tiles>

          <Note>
            <b>{games.length} game{games.length === 1 ? '' : 's'} in.</b>{' '}
            {profile.narrowLosses.length > 0 ? (
              <>
                {profile.narrowLosses.length} of the {games.filter((g) => g.margin < 0).length} defeat
                {games.filter((g) => g.margin < 0).length === 1 ? '' : 's'} came inside one score
                {' '}({thresholds.oneScore} points or fewer), the closest by
                {' '}{Math.abs(profile.narrowLosses[0].margin)}
                {profile.blownLeads.length > 0 ? `, and ${profile.blownLeads.length} of them after leading by ${BLOWN_LEAD_MARGIN} or more` : ''}.
                {' '}A roster that rates {ordinal(teamRatingRank)} going {profile.oneScoreWins}-{profile.oneScoreLosses} in one-score
                games points at the fourth quarter, not at the talent.
              </>
            ) : (
              <>No defeat has come inside one score. Whatever this season is, it is not being decided on the last possession.</>
            )}
          </Note>

          <SubHead eyebrow="Read off the stored drive log, not the final score" title="The Shape Of Each Game" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5 mt-2">
            {profile.shapes.map((s) => {
              const max = Math.max(...profile.shapes.map((x) => x.games));
              const tone = s.wins === s.games ? VIZ.good : s.wins === 0 ? VIZ.bad : VIZ.mixed;
              return (
                <div key={s.archetype} className="grid grid-cols-[92px_minmax(0,1fr)_34px] items-center gap-2 text-[11.5px] py-0.5" title={`${s.archetype}: ${s.detail}`}>
                  <span className="text-muted whitespace-nowrap">{s.archetype}</span>
                  <span className="relative h-[9px] bg-raised/70 rounded-sm overflow-hidden">
                    <i className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${(100 * s.games) / max}%`, background: tone }} />
                  </span>
                  <span className="text-right tabular-nums font-semibold">{s.wins}-{s.games - s.wins}</span>
                </div>
              );
            })}
          </div>
          <Legend keys={[]} note="Bar length is games; colour says whether the club won them all (blue), lost them all (red) or split (amber)" />

          {noArchetype && (
            <NotOnRecord>
              {noArchetype.games} game{noArchetype.games === 1 ? ' has' : 's have'} no drive log in the stored box
              score, so no shape can be read off {noArchetype.games === 1 ? 'it' : 'them'}. That is filed as
              &ldquo;not on record&rdquo; rather than guessed at.
            </NotOnRecord>
          )}
          {playoffGamesExcluded > 0 && (
            <NotOnRecord>
              {playoffGamesExcluded} postseason game{playoffGamesExcluded === 1 ? ' is' : 's are'} not counted here.
              Every stat panel on this screen is the regular season, so a playoff run never inflates a per-game figure.
            </NotOnRecord>
          )}

          <TableTwin
            caption="Table view — game by game"
            columns={['Wk', 'Opp', 'H/A', 'Score', 'Margin', 'Shape', 'Note', 'Lead changes', 'Biggest lead', 'Biggest deficit']}
            rows={games.map((g) => [
              g.week, g.oppAbbr, g.home ? 'H' : 'A', `${g.us}-${g.them}`, signed(g.margin, 0),
              g.archetype ?? '—', g.note ?? '—', g.leadChanges, g.largestLead, g.largestDeficit,
            ])}
          />
        </>
      )}
    </Panel>
  );
}

function MarginChart({ games, thresholds }: { games: MarginGame[]; thresholds: { oneScore: number; blowout: number } }) {
  const W = 660, H = 250, L = 46, R = 12, TOP = 20, BOT = 50;
  const pw = W - L - R, ph = H - TOP - BOT;
  const lim = Math.max(thresholds.blowout, ...games.map((g) => Math.abs(g.margin))) + 5;
  const y = (v: number) => TOP + ph / 2 - (ph / 2) * (v / lim);
  const bw = Math.max(6, Math.min(30, pw / games.length - 10));
  const bx = (i: number) => L + (pw * (i + 0.5)) / games.length - bw / 2;

  const rules = [thresholds.oneScore, -thresholds.oneScore, thresholds.blowout, -thresholds.blowout]
    .filter((v) => Math.abs(v) < lim);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block overflow-visible min-w-[420px]" role="img"
      aria-label="Final margin in every regular-season game played this season">
      {rules.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={VIZ.line} strokeWidth={1} />
          <text x={L - 7} y={y(v) + 3.5} textAnchor="end" className={TXT.ax}>{v > 0 ? `+${v}` : `−${Math.abs(v)}`}</text>
        </g>
      ))}
      <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke={VIZ.muted} strokeWidth={1} />
      <text x={L - 7} y={y(0) + 3.5} textAnchor="end" className={TXT.ax}>0</text>

      {games.map((g, i) => {
        const h = Math.abs(y(g.margin) - y(0));
        // Anchored to the baseline: a bar always grows FROM zero, so a loss
        // hangs below the rule rather than being drawn under it.
        const top = g.margin >= 0 ? y(g.margin) : y(0);
        const fill = g.margin >= 0 ? VIZ.good : VIZ.bad;
        return (
          <g key={`${g.week}-${g.oppAbbr}`}>
            <title>
              {`Week ${g.week} ${g.home ? 'vs' : 'at'} ${g.oppAbbr} · ${g.us}-${g.them} (${signed(g.margin, 0)})${g.archetype ? ` · ${g.archetype}` : ''}${g.note ? ` — ${g.note}` : ''}`}
            </title>
            <rect x={bx(i) - 5} y={TOP} width={bw + 10} height={ph} fill="transparent" />
            <rect x={bx(i)} y={top} width={bw} height={Math.max(2, h)} rx={3} fill={fill} />
            <text x={bx(i) + bw / 2} y={g.margin >= 0 ? top - 5 : top + h + 12} textAnchor="middle" className={TXT.lbl}>
              {signed(g.margin, 0)}
            </text>
            <text x={bx(i) + bw / 2} y={H - 26} textAnchor="middle" className={TXT.ax}>{g.home ? '' : '@'}{g.oppAbbr}</text>
            <text x={bx(i) + bw / 2} y={H - 14} textAnchor="middle" className={`${TXT.ax} opacity-60`}>W{g.week}</text>
          </g>
        );
      })}
    </svg>
  );
}
