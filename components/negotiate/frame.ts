import { formatMoney } from '@/lib/cap';
import { loyaltyBand, type NegotiationSession } from '@/lib/negotiation';

/**
 * ===========================================================================
 * ONE DESIGN, THREE STATES — WHAT ACTUALLY DIFFERS
 * ===========================================================================
 * The app owner's standing rule on this flow is that it applies "equally to
 * free agents and re-signs". Today it does, at the level of the panel — and
 * does not, at the level of the screen: free agency assembles a rival banner,
 * the re-sign list assembles a loyalty line and a suitor, and the extension
 * form assembles a paragraph about appending years. Three call sites, three
 * sets of copy, three chances to say a different thing about the same
 * mechanic.
 *
 * So the difference is resolved HERE, once, as data. Every state answers the
 * same three questions:
 *
 *   WHERE IS HE      — one of four stops on a clock that runs left to right,
 *                      from a man you control for years to a man anybody can
 *                      sign this minute.
 *   WHO ELSE CAN HAVE HIM — and, crucially, whether that is a bid today or a
 *                      fact about next spring. Nobody may sign a player who
 *                      is under contract to you, so a suitor in the re-sign
 *                      window is leverage in his asking price and never a bid
 *                      you can lose right now. Saying otherwise would be the
 *                      lying metric the README rules out.
 *   WHAT IS YOUR EDGE WORTH, AND WHICH WAY IS IT MOVING — the hometown
 *                      discount, as a band rather than a figure, because the
 *                      exact number is a term of his hidden price.
 *
 * Nothing here is invented: every field is read off the session the server
 * resolved. The clock stop is his contract, the exclusivity is the rule the
 * signing path enforces, and the discount band is `loyaltyBand` — the same
 * function the live re-sign window prints.
 * ===========================================================================
 */

export type ClockStop = 'CONTROL' | 'WALK_YEAR' | 'DEAL_UP' | 'MARKET';

export const CLOCK_STOPS: { key: ClockStop; label: string }[] = [
  { key: 'CONTROL', label: 'Years left' },
  { key: 'WALK_YEAR', label: 'Walk year' },
  { key: 'DEAL_UP', label: 'Deal up' },
  { key: 'MARKET', label: 'Market' },
];

export interface NegotiationFrame {
  /** Which of the three tables this is, in the user's words rather than the model's. */
  title: string;
  /** Where he stands on the clock your leverage runs down on. */
  stop: ClockStop;
  stopIndex: number;
  /** Can anybody else put a contract in front of him TODAY. */
  openToOthers: boolean;
  /** The exclusivity, stated. One sentence, true in this state and no other. */
  exclusivity: string;
  /** What staying is worth to him, as a band — never the figure. */
  discount: string;
  /** Which way that is moving, or null when it is not moving. */
  discountClock: string | null;
  /** What the salary control is setting: the whole deal, or the new money. */
  moneyLabel: string;
  /** What the term control is setting. */
  termLabel: string;
  /** His advertised number, and where it came from. */
  askLine: string;
}

export function negotiationFrame(session: NegotiationSession): NegotiationFrame {
  const { ctx, gate, suitor } = session;
  const appending = ctx.currentContract !== null && ctx.controlYears > 0;
  const band = loyaltyBand(ctx.loyaltyDiscount);

  const discount =
    band === 'LARGE' ? 'He is knocking a serious amount off his own price to stay.'
      : band === 'REAL' ? 'There is a real hometown discount in this.'
      : band === 'SLIGHT' ? 'There is a little left in the hometown discount.'
      : 'No hometown discount. He is priced like anybody else.';

  const askLine = ctx.openMarketApy > ctx.marketApy
    ? `Asking ${formatMoney(ctx.marketApy)}/yr — down from ${formatMoney(ctx.openMarketApy)} since nobody called`
    : `Asking ${formatMoney(ctx.marketApy)}/yr`;

  const moneyLabel = appending ? 'New money, per year' : 'Salary, per year';
  const termLabel = appending ? 'Years added' : 'Term';

  if (ctx.mode === 'EXTENSION') {
    return {
      title: 'Extension',
      stop: 'CONTROL', stopIndex: 0, openToOthers: false,
      exclusivity: `Nobody may bid on him. He is yours for ${plural(ctx.controlYears, 'more season')} whatever happens at this table.`,
      discount,
      discountClock: suitor
        ? `${suitor.teamName} would want him if he ever got out. His agent has done that arithmetic, and it is in what he asks.`
        : 'Nobody is circling. His price is his own read of himself and nothing else.',
      moneyLabel, termLabel, askLine,
    };
  }

  if (ctx.mode === 'RESIGN') {
    const finalCall = ctx.resignWindow === 'FINAL_CALL';
    return {
      title: finalCall ? 'Re-sign — his deal is up' : 'Re-sign — walk year',
      stop: finalCall ? 'DEAL_UP' : 'WALK_YEAR',
      stopIndex: finalCall ? 2 : 1,
      openToOthers: false,
      exclusivity: finalCall
        ? 'Nobody may sign him while he is yours — but his deal has run out, and one Advance from here he is theirs to bid on.'
        : `Nobody may sign him. He has this season left to play for you${appending ? ', and it is paid for already' : ''}.`,
      discount,
      discountClock: finalCall
        ? 'Most of it went when his contract ran out. This is what a last call costs.'
        : 'It shrinks the moment his deal expires, so the cheapest day to do this is today.',
      moneyLabel, termLabel, askLine,
    };
  }

  return {
    title: 'Free agent',
    stop: 'MARKET', stopIndex: 3, openToOthers: true,
    exclusivity: gate.rival
      ? `He is on the open market. ${gate.rival.teamName} can sign him today, and he weighs their years and their guaranteed money the way he weighs yours.`
      : 'He is on the open market. Anybody with the room could sign him today — nobody has.',
    discount: 'No hometown discount. He owes this club nothing.',
    discountClock: null,
    moneyLabel, termLabel, askLine,
  };
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * The man, and the club sitting opposite him. Identity is not ornament
 * (README design principle 2): the avatar, the crest and the club's colour
 * are what make this a negotiation with a person rather than a form with a
 * name in it, so they are passed in rather than looked up per direction.
 */
export interface NegotiationSubject {
  playerId: string;
  name: string;
  position: string;
  age: number;
  /** What the user's scouts say he is. */
  ovr: number;
  weightLb?: number;
  heightIn?: number;
  /** What his current deal charges this season, or null when he has none. */
  currentCapHit: number | null;
  /**
   * THE CLUB'S ACTUAL ROOM TODAY, off `teamCapSummary` — the figure the page
   * header is showing while this is open.
   *
   * Not the same number as `gate.capSpace`, and the difference matters. The
   * gate credits back whatever his current deal is charging, because the
   * signing replaces it, so on an incumbent the gate is room-plus-his-own-hit
   * — an intermediate quantity that appears nowhere else in the game. Quoting
   * it as "your room today" beside a header saying something smaller is two
   * numbers for one fact. The room AFTER is the same either way, since the
   * refund is real; only the before was wrong.
   *
   * Null where the cap is off.
   */
  capSpaceNow: number | null;
  team: { id: string; abbr: string; city: string; nickname: string };
}
