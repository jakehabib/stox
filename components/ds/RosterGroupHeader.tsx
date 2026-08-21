import { formatMoney } from '@/lib/cap';

/**
 * A group divider row for the Roster table's <tbody> — not a heading
 * component in the SectionHeading sense, since it lives inside table flow
 * (a spanning <tr><td colSpan>) rather than above a block. Gives each
 * position group (QB, Offensive Line, Secondary...) its own banner with the
 * three numbers a GM actually wants at that grain: headcount, average
 * quality, and cost — so "how deep is my O-line" is answered by the header
 * alone, before reading a single row underneath it.
 */
export function RosterGroupHeader({ label, count, avgOvr, capHit, thin }: {
  label: string;
  count: number;
  avgOvr: number;
  /** null when the league's cap tracking is off — omit the figure entirely rather than show a fake $0. */
  capHit: number | null;
  /** Two or fewer bodies at this group — one injury from a hole, same threshold the Depth Chart page flags. */
  thin: boolean;
}) {
  return (
    <tr>
      <td colSpan={9} className="px-2.5 py-1 bg-raised/40 border-y border-line/70">
        <div className="flex items-center justify-between gap-3">
          <span className="font-display font-bold text-xs uppercase tracking-wide text-chalk">{label}</span>
          <span className={`text-[11px] tnum ${thin ? 'text-warn' : 'text-muted'}`}>
            {count} {count === 1 ? 'player' : 'players'} · avg {avgOvr.toFixed(1)} OVR{capHit !== null ? ` · ${formatMoney(capHit)}` : ''}{thin ? ' · thin' : ''}
          </span>
        </div>
      </td>
    </tr>
  );
}
