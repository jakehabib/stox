import { PICK_VALUE_CHART, LEAGUE } from './tuning';

/**
 * ===========================================================================
 * A VALUE GAP, SAID IN FOOTBALL
 * ===========================================================================
 * Value points are the trade engine's currency and mean nothing to a GM
 * staring at a refusal, so every sentence that quotes one translates it. There
 * is exactly one right answer to "what is 300 points", and two copies of that
 * table is how a game ends up telling a user he needs a third on one panel and
 * a second on another — which is what it was doing, with the club's own
 * counter-offers reading off one table and the Insider report off another.
 *
 * It lives in its own leaf module, importing nothing but the chart, so both
 * lib/trade.ts and the Dynasty server actions can hold it without either one
 * dragging the other's module graph along behind it.
 *
 * THE THRESHOLDS ARE THE CHART, not numbers written down beside it: "a
 * second-rounder" is literally the band between the last pick of round two and
 * the last of round one, read off PICK_VALUE_CHART. If the league ever changes
 * size, the bands move with it. The old hand-written table was close but not
 * the chart — it called 500 points a second-rounder and 550 a first, when the
 * last pick of round one is 590.
 *
 * EVERY BAND BELOW IS THE LAST PICK OF A ROUND, which is the part of the chart
 * the round-one bend deliberately leaves alone, so none of these sentences
 * moved when it landed. The one threshold that did is the top of the range —
 * the middle of round one, 1000 before the bend and 951 after.
 */
export function describeValue(v: number): string {
  const lastOf = (round: number) => PICK_VALUE_CHART(round * LEAGUE.TEAM_COUNT);
  if (v <= 0) return 'nothing';
  if (v < lastOf(6)) return 'a seventh-rounder';
  if (v < lastOf(5)) return 'a sixth-rounder';
  if (v < lastOf(4)) return 'a fifth-rounder';
  if (v < lastOf(3)) return 'a fourth-rounder';
  if (v < lastOf(2)) return 'a third-rounder';
  if (v < lastOf(1)) return 'a second-rounder';
  // The top of the range is the MIDDLE of round one, not the top of it: past
  // that, "a first-round pick" stops being useful advice because the ordinary
  // first-rounder a user actually holds will not cover it.
  if (v < PICK_VALUE_CHART(Math.ceil(LEAGUE.TEAM_COUNT / 2))) return 'a first-round pick';
  return 'more than a first-round pick';
}
