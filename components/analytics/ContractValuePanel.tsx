import Link from 'next/link';
import { SurplusRow, CONTRACT_VALUE_MATERIAL_PCT, CONTRACT_VALUE_MATERIAL_FLOOR } from '@/lib/analytics';
import { formatMoney } from '@/lib/cap';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { tip } from '@/lib/glossary';
import { Panel, Note, TableTwin, ColLabel, ChartBox } from './Panel';
import { VIZ } from './viz';

export interface ValueRow extends SurplusRow {
  weightLb: number;
  heightIn: number;
}

/**
 * Panel 6 — who outperforms the deal, and who is an anchor.
 *
 * Market value is marketValue() from lib/cap.ts: the same curve the
 * negotiation screen quotes and every AI general manager prices off. The
 * bargain/anchor classification is classifyContractValue(), the same
 * 12%-of-value AND $1M-floor test the app already uses everywhere else, so a
 * $15K miss on a $30M quarterback never reaches this board.
 *
 * Diverging bars centred on zero, blue over red with the zero rule as the
 * neutral midpoint. Surplus is a polarity, not a status, so the app's status
 * green and red stay out of it.
 */
export function ContractValuePanel({ span = 7, bargains, overpays, leagueId, teamAccent, capEnabled, rosterSize }: {
  /** Seven columns beside the age cliff in Advanced; the full width alone in Simple. */
  span?: 7 | 12;
  bargains: ValueRow[];
  overpays: ValueRow[];
  leagueId: string;
  teamAccent: string;
  capEnabled: boolean;
  rosterSize: number;
}) {
  const rows = [...bargains, ...[...overpays].reverse()];
  const lim = Math.max(1, ...rows.map((r) => Math.abs(r.surplus))) * 1.06;
  const worst = overpays[0];
  const rookieAged = bargains.filter((b) => b.age <= 24);

  return (
    <Panel
      span={span}
      eyebrow="Cap hit against what the rating is worth"
      title="Who Outperforms The Deal, Who Is An Anchor"
      tip={tip('contractSurplus')}
      aside="Market-rate deals excluded"
      why={<>
        A deal only lands on this board once the gap clears both {Math.round(CONTRACT_VALUE_MATERIAL_PCT * 100)}% of
        the player&apos;s own value and {formatMoney(CONTRACT_VALUE_MATERIAL_FLOOR)} — one test scales with the man,
        the other keeps it anchored to money that actually moves a cap sheet.
      </>}
    >
      {!capEnabled ? (
        <p className="text-sm text-muted py-6">
          Cap mode is <strong className="text-chalk">off</strong> in this league. Every contract carries a cap hit
          of zero, so there is no surplus to rank here.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted py-6">
          Not one of the {rosterSize} contracts on this roster misses its market value by enough to matter. That
          is a flat cap sheet — nothing to celebrate, nothing to cut.
        </p>
      ) : (
        <>
          {/* THE BOARD IS 502px WIDE AT ITS NARROWEST and the panel it sits in
              is 300 on a handset, because four of the five tracks carry a
              minimum: 34 for the portrait, 190 for the name, 100 for the bar
              and 72 + 66 for the two money columns. With nothing to scroll in,
              those minimums came out of the card and pushed the whole
              Analytics page 202px sideways — measured at 390px, the single
              largest source of horizontal scroll left on the route. `ChartBox`
              is this department's own answer to exactly that ("wide content
              scrolls here, never on the page body"), and the two header
              tooltips are already set to open downward, which is what a
              bubble inside a scroller has to do. Nothing moves at a width
              where the board already fits. */}
          <ChartBox>
          <div className="grid grid-cols-[34px_minmax(190px,320px)_minmax(100px,1fr)_72px_66px] gap-2.5 label-sm text-[9.5px] pb-1.5 border-b border-line">
            <span />
            <span>Player</span>
            <span><ColLabel label="Surplus against market" tip={tip('marketValue')} align="start" /></span>
            <span className="text-right">Surplus</span>
            <span className="text-right"><ColLabel label="Cap hit" tip={tip('capHit')} align="end" /></span>
          </div>
          {rows.map((r) => {
            const positive = r.surplus >= 0;
            const w = (Math.abs(r.surplus) / lim) * 50;
            return (
              <Link
                key={r.playerId}
                href={`/league/${leagueId}/player/${r.playerId}?view=contract`}
                className="grid grid-cols-[34px_minmax(190px,320px)_minmax(100px,1fr)_72px_66px] gap-2.5 items-center py-1 border-b border-line/45 hover:bg-raised/45"
                title={`${r.name} (${r.position}, ${r.age}) · rated ${r.ovr} · cap hit ${formatMoney(r.hit)} against a ${formatMoney(r.marketValue)} market · ${positive ? 'surplus' : 'overpay'} ${formatMoney(Math.abs(r.surplus))}`}
              >
                <PlayerAvatar seed={r.playerId} age={r.age} size={30} teamColor={teamAccent} weightLb={r.weightLb} heightIn={r.heightIn} position={r.position} />
                <span className="flex items-baseline gap-1.5 min-w-0">
                  <span className="text-[12.5px] font-semibold truncate">{r.name}</span>
                  <span className={`pill text-[9.5px] px-1 py-0 leading-4 shrink-0 ${positionBadgeClass(r.position)}`}>{r.position}</span>
                  <span className="text-[10.5px] text-muted tabular-nums whitespace-nowrap">{r.age}y · {r.ovr} ovr</span>
                </span>
                <span className="relative h-4 bg-raised/70 rounded-sm">
                  <i className="absolute left-1/2 -top-0.5 -bottom-0.5 w-px bg-line" />
                  <i
                    className="absolute top-[3px] h-2.5"
                    style={positive
                      ? { left: '50%', width: `${w}%`, background: VIZ.good, borderRadius: '0 3px 3px 0' }
                      : { right: '50%', width: `${w}%`, background: VIZ.bad, borderRadius: '3px 0 0 3px' }}
                  />
                </span>
                <span className="text-right text-xs tabular-nums font-semibold" style={{ color: positive ? VIZ.good : VIZ.bad }}>
                  {positive ? '+' : '−'}{formatMoney(Math.abs(r.surplus)).replace('$', '')}
                </span>
                <span className="text-right text-xs tabular-nums text-muted">{formatMoney(r.hit)}</span>
              </Link>
            );
          })}
          </ChartBox>

          <Note>
            {worst ? (
              <>
                <b>{worst.name}</b> is the largest gap on the board: {formatMoney(worst.hit)} against a
                {' '}{formatMoney(worst.marketValue)} market at {worst.age}.
              </>
            ) : (
              <>Nothing on this roster clears the overpay threshold.</>
            )}
            {bargains.length > 0 && (
              <>
                {' '}Against that, {rookieAged.length} of the {bargains.length} bargain{bargains.length === 1 ? '' : 's'}
                {rookieAged.length === 1 ? ' is' : ' are'} 24 or younger — cheap years, not clever negotiating.
              </>
            )}
            {' '}Market value knows rating, age and potential. It does not know what a man is to a locker room,
            and neither does this board.
          </Note>

          <TableTwin
            caption="Contract value, in numbers"
            columns={['Player', 'Pos', 'Age', 'Rating', 'Cap hit', 'Market', 'Surplus', 'Verdict']}
            tips={{
              Rating: tip('overall'),
              'Cap hit': tip('capHit'),
              Market: tip('marketValue'),
              Surplus: tip('contractSurplus'),
            }}
            rows={rows.map((r) => [
              r.name, r.position, r.age, r.ovr, formatMoney(r.hit), formatMoney(r.marketValue), formatMoney(r.surplus), r.tier,
            ])}
          />
        </>
      )}
    </Panel>
  );
}
