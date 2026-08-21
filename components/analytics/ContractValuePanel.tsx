import Link from 'next/link';
import { SurplusRow, CONTRACT_VALUE_MATERIAL_PCT, CONTRACT_VALUE_MATERIAL_FLOOR } from '@/lib/analytics';
import { formatMoney } from '@/lib/cap';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { Panel, Note, TableTwin } from './Panel';
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
export function ContractValuePanel({ bargains, overpays, leagueId, teamAccent, capEnabled, rosterSize }: {
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
      span={7}
      eyebrow="Cap hit against what the rating is worth"
      title="Who Outperforms The Deal, Who Is An Anchor"
      aside="Market-rate deals excluded"
      why={<>
        A deal only lands on this board once the gap clears both {Math.round(CONTRACT_VALUE_MATERIAL_PCT * 100)}% of
        the player&apos;s own value and {formatMoney(CONTRACT_VALUE_MATERIAL_FLOOR)} — one test scales with the man,
        the other keeps it anchored to money that actually moves a cap sheet.
      </>}
    >
      {!capEnabled ? (
        <p className="text-sm text-muted py-6">
          Cap mode is <strong className="text-chalk">off</strong> in this league. Every contract carries a cap hit of
          zero, so there is no surplus to rank and this board has nothing honest to say.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted py-6">
          Not one of the {rosterSize} contracts on this roster misses its market value by enough to clear the
          threshold above. That is a genuinely flat cap sheet, not an empty panel.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[34px_minmax(190px,1.25fr)_minmax(100px,1fr)_72px_66px] gap-2.5 label-sm text-[9.5px] pb-1.5 border-b border-line">
            <span />
            <span>Player</span>
            <span>Surplus against market</span>
            <span className="text-right">Surplus</span>
            <span className="text-right">Cap hit</span>
          </div>
          {rows.map((r) => {
            const positive = r.surplus >= 0;
            const w = (Math.abs(r.surplus) / lim) * 50;
            return (
              <Link
                key={r.playerId}
                href={`/league/${leagueId}/player/${r.playerId}`}
                className="grid grid-cols-[34px_minmax(190px,1.25fr)_minmax(100px,1fr)_72px_66px] gap-2.5 items-center py-1 border-b border-line/45 hover:bg-raised/45"
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
            {' '}Market value is a function of rating, age and potential only; it does not know who a player is to a
            locker room, and neither does this board.
          </Note>

          <TableTwin
            caption="Table view — contract value"
            columns={['Player', 'Pos', 'Age', 'Rating', 'Cap hit', 'Market', 'Surplus', 'Verdict']}
            rows={rows.map((r) => [
              r.name, r.position, r.age, r.ovr, formatMoney(r.hit), formatMoney(r.marketValue), formatMoney(r.surplus), r.tier,
            ])}
          />
        </>
      )}
    </Panel>
  );
}
