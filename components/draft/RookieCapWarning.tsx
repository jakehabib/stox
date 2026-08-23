import Link from 'next/link';
import { formatMoney } from '@/lib/cap';
import { positionBadgeClass } from '../ds/positionColor';
import type { RookieCapOutlook } from '@/lib/draft';

/** Named relief moves the panel will carry. [TUNE] */
const RELIEF_SHOWN = 4;

/**
 * WHAT HIS OWN DRAFT COSTS, SAID BEFORE HE PRESSES START.
 *
 * A rookie deal is real cap money and draftPlayer blocks the user on it — on
 * the clock, short clock running, board up. That is the worst possible moment
 * to learn you cannot pay the man you just picked, and it is the only moment
 * the game used to tell you. An AI club never has it: it releases veterans to
 * fit its own pool and the room moves on.
 *
 * IT SITS IN THE WAR ROOM AND NOT IN THE START BUTTON'S CONFIRM. That confirm
 * is one question asked once about unspent workouts, and it disappears the
 * moment the answer is "none left" (see StartDraftButton). This is not a
 * question — it is the state of the books, it is true whether or not he clicks
 * anything, and the moves it points at are on other screens. So it stands in
 * the panel above the button and the two never occupy the same space — the
 * confirm replaces the button, this stays put. It also takes the harder of the
 * two palettes when a card is actually going to be refused (bad, not warn), so
 * "you cannot pay for this" never reads as the same weight as "you have
 * workouts left".
 *
 * IT IS NOT A VERDICT AND MUST NOT READ LIKE ONE. He can cut, restructure or
 * trade between now and the podium, and an AI club may hand him a deal. Every
 * figure here is his books tonight, which is what the last line says.
 */
export function RookieCapWarning({ leagueId, outlook }: {
  leagueId: string;
  outlook: RookieCapOutlook;
}) {
  const { picks, pool, capSpace, cushion, stopsAt, shortfall, clearable, relief } = outlook;
  const overNow = capSpace < 0;
  // The books in one clause, and it has to survive a club that is ALREADY
  // over: "against -$23.9M of room" is a number nobody says out loud.
  const room = overNow
    ? `and you are already ${formatMoney(-capSpace)} over the ceiling`
    : `against ${formatMoney(capSpace)} of room`;
  const selections = `Your ${picks.length} selection${picks.length === 1 ? '' : 's'} price out at ${formatMoney(pool)}`;
  // TWO NUMBERS, NOT ONE. The shortfall at the card that stops is what the
  // block will actually quote him, but on its own it invites the wrong move:
  // clearing $1.02M gets him past pick 21 and stopped again at pick 53. The
  // deficit across the whole class is what he has to find to draft it, and a
  // warning that names only the first one is a warning he acts on twice.
  const deficit = pool - capSpace;
  const wholeClass = picks.length > 1 && deficit > shortfall
    ? `, and ${formatMoney(deficit)} to sign all ${picks.length}`
    : '';

  return (
    <div className={`panel p-4 space-y-3 max-w-2xl ${stopsAt ? 'border-bad/50 bg-bad/5' : 'border-warn/50 bg-warn/5'}`}>
      <div className={`label-sm ${stopsAt ? 'text-bad' : 'text-warn'}`}>
        {stopsAt ? 'The class does not fit' : 'This class leaves you nothing'}
      </div>

      <p className="text-sm text-chalk/90 leading-snug">
        {selections} {room}.{' '}
        {stopsAt ? (
          clearable ? (
            <>
              As the roster stands the money runs out at Round {stopsAt.round}, pick {stopsAt.slot} — find{' '}
              {formatMoney(shortfall)} or that card does not go in{wholeClass}.
            </>
          ) : (
            <>
              As the roster stands the money runs out at Round {stopsAt.round}, pick {stopsAt.slot}, and no cut
              or restructure on this roster covers it — the selection goes in and you carry the overage.
            </>
          )
        ) : (
          <>
            That leaves {formatMoney(cushion)} standing when the last card is in — nothing behind it for an
            undrafted signing or a week-two replacement.
          </>
        )}
      </p>

      {/* The way out, named — but only when a card is actually going to be
          refused. Same shape and same source as the standing over-cap bar
          (capReliefOptions), so a GM who has seen one recognises the other
          instead of learning a second vocabulary. A club that CAN sign its
          whole class and is merely left thin is being told something, not
          asked to do something, and putting "cut your best edge rusher" under
          that sentence would read as an instruction it is not.
          The named moves also go when nothing on the roster covers the bill:
          the sentence above has just said no cut or restructure gets there,
          and a row of cuts underneath it would be arguing with itself. The
          trade stays, because that is the route that is left. */}
      {stopsAt && (
        <div className="flex items-center gap-2 flex-wrap">
          {/* Two of each shape, not the full list: a GM already carrying the
              standing over-cap bar is looking at these same names up there,
              and six chips in a panel he has to read before a decision is a
              wall. Two cuts and two restructures still say "you have both
              kinds of move", which is the whole point of the interleave. */}
          {clearable && relief.slice(0, RELIEF_SHOWN).map((m) => (
            <Link
              key={`${m.kind}-${m.playerId}`}
              href={`/league/${leagueId}/player/${m.playerId}?view=contract`}
              className="pill border-line bg-raised hover:border-warn/50 gap-1.5"
              title={`${m.kind === 'CUT' ? 'Release' : 'Restructure'} to free ${formatMoney(m.frees)}`}
            >
              <span className="text-[10px] uppercase tracking-wide text-muted">{m.kind === 'CUT' ? 'Cut' : 'Restr'}</span>
              <span className={`font-semibold ${positionBadgeClass(m.position)}`}>{m.position}</span>
              <span className="text-chalk">{m.name}</span>
              <span className="font-mono text-accent">+{formatMoney(m.frees)}</span>
            </Link>
          ))}
          <Link href={`/league/${leagueId}/trade`} className="pill border-line bg-raised hover:border-warn/50 text-muted">
            {clearable ? 'or send salary out in a trade' : 'send salary out in a trade'}
          </Link>
        </div>
      )}

      <p className="text-[11px] text-muted leading-snug">
        That is tonight&rsquo;s books. Anything you cut, restructure or deal before the first card moves the
        number with you.
      </p>
    </div>
  );
}
