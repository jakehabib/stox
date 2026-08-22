/**
 * ===========================================================================
 * THE GLOSSARY — one definition per term, for the whole game
 * ===========================================================================
 * Every explanatory tooltip in the app reads from here. That is the entire
 * point of the file: this codebase's most persistent defect is two places
 * describing the same thing and drifting apart — a twelve-man defence in two
 * duplicated tables, a power-ranking note contradicting its own table, three
 * different definitions of "starter". "Dead money" is now explained in exactly
 * the same words on the cap sheet, the player card, the re-sign window and the
 * trade builder, and a rewrite lands on all four at once.
 *
 * THE SHAPE, AND WHY
 *
 *   `definition` is what the thing IS, in football language.
 *   `why` is the optional second beat — why a GM should care, or what counts
 *   as good, bad and normal. It is optional because forcing one produces
 *   padding, and a padded tooltip is worse than a short one.
 *
 * `tip()` glues the two together, so a call site never has to decide how to
 * present a term and two call sites can never present the same term
 * differently. Where a layout genuinely cannot carry a "?" — a nine-column
 * standings table — the same string goes into a native `title` instead, which
 * keeps one voice even where the affordance has to change.
 *
 * Keyed by a camelCase id rather than held in an array: `tip('deadMoney')` is
 * greppable back to this file in one hop, the lookup is O(1), and — the real
 * argument — `GlossaryKey` makes a misspelled term a compile error rather
 * than an empty bubble in production.
 *
 * THE WRITING STANDARD, which is the hard part and not the wiring:
 *
 *   Useful and informative, never an explainer that breaks immersion. A
 *   tooltip explains the FOOTBALL concept. It never mentions the database, a
 *   box score, a stat line, this save, the sim, or how a number is computed
 *   internally. "Signing bonus you already paid, accelerated onto the books
 *   the year you cut him" — not "Contract.signingBonus / proration years".
 *
 *   Give a sense of scale wherever it can be supported honestly: what is
 *   good, what is bad, what is normal. That is the thing a new GM actually
 *   lacks. Every threshold quoted below comes either from this game's own
 *   tuning (lib/tuning.ts, lib/ratings.ts, lib/cap.ts) or from a real-sport
 *   fact — never from a number invented to sound authoritative.
 *
 *   AND WHERE THE TWO DISAGREE, THIS LEAGUE WINS. Several per-play rates here
 *   do not land where real football lands — measured over fifteen played
 *   seasons the median passer sits at 5.4 yards an attempt (the real game is
 *   nearer 7.0), the median back at 5.4 a carry (the real game is nearer 4.3),
 *   the median receiver at 8.6 a catch (the real game is nearer 12) and the
 *   median starting passer at an 87 rating. Quoting the real-world figure
 *   beside a table that never produces it would be the lying-metric failure in
 *   its purest form: a tooltip telling a GM his best quarterback is bad at a
 *   number no quarterback in this league has ever reached. So the passing,
 *   rushing, receiving and kicking benchmarks describe THIS league's
 *   landscape. Completion rate, touchdown rate and interception rate land
 *   close enough to the real game that the two agree anyway.
 * ===========================================================================
 */

export interface GlossaryTerm {
  /** The name this is usually labelled with on screen. Here for greppability from a label back to its definition. */
  term: string;
  /** What it is. Football language, one or two sentences. */
  definition: string;
  /** Why a GM should care, or what good/bad/normal looks like. Omitted where there is nothing honest to add. */
  why?: string;
}

/**
 * `satisfies` rather than a plain annotation: it type-checks every entry and
 * still keeps the literal keys, which is what makes GlossaryKey a real union
 * instead of `string`.
 */
export const GLOSSARY = {
  // -------------------------------------------------------------------------
  // SALARY CAP
  // -------------------------------------------------------------------------
  capHit: {
    term: 'Cap hit',
    definition: 'What a player counts against the salary cap this season — his base salary for the year plus the slice of his signing bonus charged to it.',
    why: 'It is what he costs your books, not what lands in his bank account. The two rarely match, and the gap is where every clever contract lives.',
  },
  capSpace: {
    term: 'Cap space',
    definition: 'The cap ceiling minus everything already committed: salaries, bonus charges and dead money.',
    why: 'What you can spend today without clearing something first. Going negative is not a state you are allowed to sit in — the new league year will not open while you are over.',
  },
  capLimit: {
    term: 'Cap limit',
    definition: 'The ceiling every club has to fit its spending under this season. The same figure for all 32 teams.',
    why: 'It rises about 7% a year, so a contract that looks heavy today is quietly getting lighter every season it survives.',
  },
  committedCap: {
    term: 'Committed',
    definition: 'Everything already charged to this season — every contract on the roster plus any dead money left by players who are gone.',
  },
  deadMoney: {
    term: 'Dead money',
    definition: 'Money still charged against your cap for a player who is no longer on the roster: signing bonus you already paid, accelerated onto the books the year you cut him, plus any guaranteed salary you still owe a man who will not be playing for you.',
    why: 'It buys you nothing. It is also what turns a release into a real decision rather than a delete button — and a cap sheet heavy with it is a roster of ghosts.',
  },
  proration: {
    term: 'Proration',
    definition: 'A signing bonus is paid up front but charged to the cap in equal slices — over the length of the deal, to a maximum of five seasons.',
    why: 'It is why a long contract gets cheap to escape near the end: from year six onward there is no bonus left to charge, and by then his guarantees are long since collected.',
  },
  voidYears: {
    term: 'Void years',
    definition: 'Fake seasons tacked onto the end of a deal. He never plays them and is never paid for them — they exist only to spread the signing bonus across more years and shrink this season\'s charge.',
    why: 'The bill does not disappear. Every prorated dollar still sitting on those years lands as dead money the moment the real contract ends.',
  },
  guaranteedMoney: {
    term: 'Guaranteed money',
    definition: 'The part of a contract the player collects whatever happens — including if you release him. The signing bonus is inside that figure, not on top of it: it is handed over on day one and no release gets it back.',
    why: 'It is the number that separates a real commitment from a tryout with paperwork, which is why agents fight harder over it than over the headline total.',
  },
  capSavingsOnCut: {
    term: 'Cap saving on a cut',
    definition: 'What releasing a player actually frees: this year\'s cap hit, minus the dead money the release leaves behind.',
    why: 'On a deal signed recently the dead money can be larger than the hit — cutting him then costs you room instead of creating it.',
  },
  restructure: {
    term: 'Restructure',
    definition: 'Converting salary a player is owed this year into signing bonus, which spreads it over the remaining seasons and drops this year\'s charge.',
    why: 'The standard way to fit a signing you cannot otherwise afford — but every dollar you move is a dollar of future dead money. Only restructure a player you intend to keep.',
  },
  dealShape: {
    term: 'Front-loaded / back-loaded',
    definition: 'How a deal\'s salary is spread across its years. Front-loaded pays more early and less later; back-loaded does the reverse.',
    why: 'The player mostly cares about the total and what is guaranteed, so the shape is your problem, not his: back-loading buys room now and hands the bill to a future roster.',
  },
  apy: {
    term: 'APY',
    definition: 'Average per year — total contract value divided by its length. The standard shorthand for what a player is paid.',
    why: 'It hides the shape. A back-loaded deal has an APY he never earns in any single season, and on an extension the quoted APY usually covers only the new years, not the ones already on the books.',
  },
  newMoney: {
    term: 'New money',
    definition: 'On an extension, the money attached to the years being added. The seasons already on his deal keep their existing salaries.',
    why: 'A "4 year, $120M extension" is $30M a year of new money. Averaged across the whole contract it is a smaller number — quoting either as the other is how a cap sheet surprises somebody.',
  },
  franchiseTag: {
    term: 'Franchise tag',
    definition: 'A one-year deal you can force on a single expiring player, priced at the average of the five biggest salaries at his position.',
    why: 'It keeps a star off the market for a season without a long commitment. It is expensive, it is fully guaranteed, and it buys you a year rather than a solution.',
  },
  rookieDeal: {
    term: 'Rookie deal',
    definition: 'The four-year contract a drafted player signs, priced by where he was taken rather than negotiated.',
    why: 'The cheapest good football in the sport. A first-round starter on a rookie deal is worth two of the same player on a second contract, which is most of the argument for building through the draft.',
  },
  rookieScale: {
    term: 'Rookie scale',
    definition: 'The fixed price list for drafted players — the first pick in the draft earns the most and it falls away steadily to the last.',
  },
  capMode: {
    term: 'Cap mode',
    definition: 'How strictly this league runs its books. Realistic charges bonus proration and leaves dead money behind on a cut; Simplified charges a flat yearly figure with no dead money; Off removes the ceiling entirely.',
  },
  topFiveConcentration: {
    term: 'Top-5 concentration',
    definition: 'The share of your committed cap tied up in your five largest contracts.',
    why: 'Above roughly 45% is a top-heavy roster — a few stars carrying a thin supporting cast. A real strategy, but it leaves little room to absorb an injury or a contract that goes wrong.',
  },
  capWeightedAge: {
    term: 'Cap-weighted age',
    definition: 'The average age of your roster weighted by cap dollars — how old the money is, rather than how old the squad is.',
    why: 'Well above the plain roster average means your spending is concentrated in older players, so the cap sheet will age out faster than the depth chart suggests.',
  },

  // -------------------------------------------------------------------------
  // NEGOTIATION
  // -------------------------------------------------------------------------
  marketValue: {
    term: 'Market value',
    definition: 'The going rate for a player of his position, rating and age — an open estimate of what he would fetch if every club could bid.',
    why: 'Position matters more than most people expect: a quarterback is paid roughly three times what an equally-rated running back is, because one of those jobs decides games.',
  },
  interestMeter: {
    term: 'Interest',
    definition: 'How this offer is landing with the player, from cold to signed. The marks on the track are the points where his answer changes — considering, close, and the line where he signs.',
    why: 'His actual price stays hidden; the rules do not. You can always see how far you are from a yes, you just cannot see the number that gets you there.',
  },
  maybeBand: {
    term: 'Might sign',
    definition: 'The stretch of the meter where he could go either way. Inside it an offer is a genuine gamble.',
    why: 'The band is as wide as your uncertainty about the man — the better your scouts know him, the narrower it is, and the more of a coin flip it is otherwise.',
  },
  patience: {
    term: 'Patience',
    definition: 'How many rejected offers a player will sit through before he stops taking your calls this year.',
    why: 'It is what stops you finding his number by guessing. Insulting offers cost two pips instead of one, so a lowball is a real spend rather than a free probe.',
  },
  guaranteeFloor: {
    term: 'Guarantee floor',
    definition: 'The share of a deal a player will not go below having locked in. Below it he is refusing the structure, not the money.',
    why: 'No salary fixes it — a star does not put his name to a big contract with nothing guaranteed at any price. Backups have no floor at all; the better the player, the more he wants in writing.',
  },
  walkYear: {
    term: 'Walk year',
    definition: 'The last season on a player\'s contract. He is still yours, nobody else may sign him, and free agency is one offseason away.',
    why: 'This is the cheap window. The discount for staying is at its biggest here and mostly gone once the deal has actually expired.',
  },
  loyaltyDiscount: {
    term: 'Hometown discount',
    definition: 'The amount a player knocks off his own price to stay where he is, rather than test the market.',
    why: 'It shrinks as his contract runs out. Getting ahead of a re-sign is worth real money; waiting until he is a free agent in all but name is not.',
  },
  setAside: {
    term: 'Set aside',
    definition: 'A decision parked rather than made. He is not released and you can bring him back at any time before the window closes.',
    why: 'Parking is not keeping. Anyone still set aside with an expired deal walks to free agency when the phase ends.',
  },
  suitor: {
    term: 'Suitor',
    definition: 'A rival club with real interest — one that has the cap room and the hole at that position to actually make the call.',
    why: 'The figure quoted is roughly what they would offer if he reached the market, so it is the price you are bidding against rather than atmosphere.',
  },

  // -------------------------------------------------------------------------
  // RATINGS AND SCOUTING
  // -------------------------------------------------------------------------
  overall: {
    term: 'Overall (OVR)',
    definition: 'One number for how good a player is right now, weighted for what his position actually has to do.',
    why: 'The ladder: 70 is a starter, 78 a quality one, 85 a star, 90 elite. Above that you are into the handful of players who decide games on their own, and a 99 is the kind of talent a club builds a decade around.',
  },
  potential: {
    term: 'Potential',
    definition: 'The ceiling a player could reach if he develops well. Nobody is guaranteed to get there, and plenty stop short.',
    why: 'It is the hardest thing in football to judge, so it is always shown as a range — even a scout who has watched a man all year will not give you a single number.',
  },
  ratingColours: {
    term: 'Rating colours',
    definition: 'The colour on a rating is the tier it falls in — gold for elite, then star, quality starter, starter, and grey for depth.',
    why: 'Below starter level the colour stays neutral on purpose. Everyone on a roster cannot be exceptional, and colouring the bottom of it only makes the top harder to find.',
  },
  scoutedRange: {
    term: 'Scouted range',
    definition: 'The span your scouts will commit to rather than a single number. The wider it is, the less certain they are.',
    why: 'It narrows as they spend time on him. It never collapses to a point on a prospect, which is exactly why draft picks bust.',
  },
  scoutingConfidence: {
    term: 'Confidence',
    definition: 'How complete your file on a player is. Low means an early look and a rough sketch; high means the department has a real book on him.',
    why: 'Physical traits converge fast — a stopwatch does not lie. How he reads a defence stays foggy far longer, and that is the read that decides careers.',
  },
  devTrait: {
    term: 'Development trait',
    definition: 'How quickly a player improves compared with an ordinary teammate — from slow, through normal, to star and superstar.',
    why: 'A superstar developer climbs roughly twice as fast as a normal one. It is why two rookies with the same rating can be four years apart by 25.',
  },
  shortlist: {
    term: 'Shortlist',
    definition: 'The prospects your scouting department works every week. Starring a man puts him in front of your staff for the rest of the season, at no cost.',
    why: 'The weekly effort is fixed and split evenly. Star five and each gets a fifth of everything you have; star sixty and you will know a little about sixty men and enough about none of them.',
  },
  attentionUnits: {
    term: 'Attention',
    definition: 'One week of your scouting department\'s work on one prospect. The week\'s total is fixed, so it is divided between everyone you have starred.',
  },
  privateWorkout: {
    term: 'Private workout',
    definition: 'A prospect flown in for your own staff to test. Every measurable comes back exact and the ceiling projection tightens to about as narrow as it ever gets.',
    why: 'The only thing in scouting you can run out of — a handful a year, pre-draft only. It will not tell you how he reads a defence, which is the read that busts picks.',
  },
  fullScout: {
    term: 'Full scout',
    definition: 'Dropping everything to build one complete, exact file on a single player. No range, no doubt.',
    why: 'Deliberately not enough of them to cover a draft class. Spending one is the admission that this is the man your season turns on.',
  },
  combineTesting: {
    term: 'Combine testing',
    definition: 'The standard set of athletic drills every prospect runs in front of the league — speed, explosiveness, change of direction and strength.',
    why: 'Public and identical for everyone, which is exactly why it is over-weighted: it measures what a stopwatch can measure, and nothing about how a man plays football.',
  },
  combineForty: {
    term: '40-yard dash',
    definition: 'A straight-line sprint from a standing start. The headline speed number, and the one the room over-trusts.',
  },
  combineThreeCone: {
    term: '3-cone drill',
    definition: 'A timed L-shaped course around three cones. It measures the ability to sink the hips and change direction sharply — a pass rusher bending the edge, a receiver breaking off a route.',
  },
  combineShuttle: {
    term: 'Shuttle',
    definition: 'Five yards right, ten yards left, five yards back. Short-area quickness and the ability to stop and restart, which matters far more than top speed for most jobs on the field.',
  },
  combineVertical: {
    term: 'Vertical jump',
    definition: 'A standing leap, measured off the highest point reached. Explosiveness through the hips, and a fair proxy for winning a contested ball.',
  },
  combineBroad: {
    term: 'Broad jump',
    definition: 'A standing jump for distance. The same explosiveness the vertical measures, pushed forward rather than up.',
  },
  combineBench: {
    term: 'Bench press',
    definition: 'Repetitions at 225 pounds. Upper-body strength endurance — most relevant to linemen, largely decoration for a receiver.',
  },
  proDay: {
    term: 'Pro day',
    definition: 'A prospect testing at his own school instead of at the league combine.',
    why: 'His surface, his timing, his crowd. Pro day numbers tend to run a touch fast, and the room does not always discount them.',
  },
  competitionGrade: {
    term: 'Competition faced',
    definition: 'The standard of opposition a prospect played against in college, A-tier down to F.',
    why: 'Production against D-tier defences is worth less than the same production against A-tier ones — and the room is not always careful about the difference.',
  },

  // -------------------------------------------------------------------------
  // THE DRAFT BOARD
  // -------------------------------------------------------------------------
  consensusBoard: {
    term: 'Consensus board',
    definition: 'How the league as a whole rates this draft class. Free, public, and identical for every front office.',
    why: 'Your edge is not having it — everyone does. It is knowing where it is wrong, and it is wrong in named, visible ways: it over-trusts a stopwatch, takes a big programme at its word, and marks down anyone unfinished or flagged.',
  },
  boardGrade: {
    term: 'Board grade',
    definition: 'What the room thinks a prospect is worth, blending what he is now with what he might become.',
    why: 'It is talk, and on the prospects that matter most it is usually wrong. Your own grade sitting well above or below it is the whole reason to scout anybody.',
  },
  prospectProjection: {
    term: 'Projection',
    definition: 'The role your own scouts think a prospect grows into — a starter, a star, a rotational piece — drawn from his ceiling rather than what he is today.',
    why: 'It stays hidden until there is a real file on him, and it is shown hedged while the read is still forming. A rookie\'s present-day number means almost nothing; the projection is the whole story, which is also why it can move as you learn more.',
  },
  draftBand: {
    term: 'Draft band',
    definition: 'Roughly where the league expects a prospect to come off the board — blue chip, first round, day two, day three, or an undrafted flier.',
  },
  positionalValue: {
    term: 'Positional value',
    definition: 'How much a position is worth relative to its raw rating. A quarterback, edge rusher or left tackle is worth more than an equally-good running back, because the job decides more games.',
    why: 'It is why a lower-graded prospect sits above a higher-graded one on the board, and why an evenly-rated running back is the cheapest player in football to sign.',
  },
  pickValue: {
    term: 'Pick value',
    definition: 'What a draft pick is worth in trade. The curve is steep at the top — the first pick is worth far more than the fifth, and a whole late round is worth less than one early selection.',
    why: 'Future years are discounted, which is why a rebuilding club takes three next-year picks for one this year and a contender does the opposite.',
  },
  draftHitRate: {
    term: 'Draft hit rate',
    definition: 'The share of your picks that turned into genuine contributors. The bar is highest for a first-rounder and eases a little each round after — nobody expects a seventh-round pick to start.',
    why: 'It only appears once you have made five picks. Below that it is noise, and a 1-for-2 record is not a scouting department.',
  },
  onTheClock: {
    term: 'On the clock',
    definition: 'Whose turn it is to pick. Nothing moves until they make a selection.',
  },

  // -------------------------------------------------------------------------
  // PLAYER STATS
  // -------------------------------------------------------------------------
  passerRating: {
    term: 'Passer rating',
    definition: 'The real NFL formula — completion rate, yards per attempt, touchdown rate and interception rate, each capped and blended into one number.',
    why: 'Middle of this league is the high 80s. Mid-90s is a very good year and 100 is about as high as anyone gets; 158.3 is the formula\'s ceiling and nobody is near it.',
  },
  completionPct: {
    term: 'Completion %',
    definition: 'The share of passes thrown that were caught.',
    why: 'Around 65% is normal for a modern starter. On its own it says little — a quarterback checking down all afternoon can lead the league in it.',
  },
  yardsPerAttempt: {
    term: 'Yards per attempt (Y/A)',
    definition: 'Passing yards divided by passes thrown — how much ground a throw is worth on average, whether or not it is caught.',
    why: 'Around 5.4 is the middle of the league. Close to 6 is a genuinely dangerous passing game; under 5 usually means a lot of short, safe throws that never threaten anybody.',
  },
  tdRate: {
    term: 'TD %',
    definition: 'The share of passes that went for a touchdown.',
    why: 'Around 4-5% is normal. It is heavily flattered by a good red-zone offence, so it says as much about the team as the quarterback.',
  },
  intRate: {
    term: 'INT %',
    definition: 'The share of passes that were intercepted.',
    why: 'Under 2% is careful and a shade under 2% is ordinary. Much past 2.5% and he is handing games away, whatever else the line says.',
  },
  yardsPerCarry: {
    term: 'Yards per carry (YPC)',
    definition: 'Rushing yards divided by carries.',
    why: 'Around 5.4 is the middle of the pack. Approaching 6 is a real running game; under 5 and the run is costing you more than it gains.',
  },
  catchRate: {
    term: 'Catch %',
    definition: 'Catches divided by times targeted — how often a ball thrown his way is actually caught.',
    why: 'Low sixties is normal for a receiver. A back or tight end working underneath runs higher and a deep threat lower, so it is only fair to compare like with like.',
  },
  yardsPerReception: {
    term: 'Yards per reception (Y/R)',
    definition: 'Receiving yards divided by catches — how far he goes with each ball he holds on to.',
    why: 'Around 8.5 is the usual mark for a receiver. Past 10 is a genuine deep threat; a back or a slot man catching everything underneath sits well below it and is not worse for it.',
  },
  yardsPerTarget: {
    term: 'Yards per target',
    definition: 'Receiving yards divided by times thrown at, whether or not he caught it.',
    why: 'The fairer of the two receiving rates, because a drop counts against him. Around 5.3 is normal, and it is the number that tells you whether throwing at him is a good idea.',
  },
  yardsPerTouch: {
    term: 'Yards per touch',
    definition: 'Total yards from scrimmage divided by carries plus catches — one figure for a player used both ways.',
  },
  fieldGoalPct: {
    term: 'FG %',
    definition: 'The share of field goal attempts made.',
    why: 'Around 80% is an ordinary year. Past 90% is a kicker you trust in December; below 70% he is costing you the close games a kicker exists to win.',
  },
  passesDefensed: {
    term: 'Passes defensed',
    definition: 'Throws a defender broke up without intercepting. The near-misses.',
    why: 'Interceptions are lumpy year to year; this is the steadier read on whether a corner is actually covering anybody.',
  },
  forcedFumbles: {
    term: 'Forced fumbles',
    definition: 'Times a defender knocked the ball loose from a ball carrier.',
  },
  tacklesForLoss: {
    term: 'Tackles for loss (TFL)',
    definition: 'Tackles made behind the line of scrimmage — a play stopped before it started.',
  },
  scrimmageYards: {
    term: 'Yards from scrimmage',
    definition: 'Rushing and receiving yards added together, for a player who is used both ways.',
  },

  // -------------------------------------------------------------------------
  // TEAM AND LEAGUE
  // -------------------------------------------------------------------------
  teamOverall: {
    term: 'Team overall',
    definition: 'One number for how good a roster is — the players who actually take the field at each unit, weighted by how much that unit decides games.',
    why: 'It counts starters, not squad size — you are not worse at receiver for carrying a seventh one. Quarterback alone is worth about a fifth of it.',
  },
  unitRating: {
    term: 'Unit rating',
    definition: 'How good one part of the roster is — the average of the men who start there.',
    why: 'The rank beside it is the one that means something. A 79 offence is good or bad depending entirely on what the other 31 clubs have.',
  },
  pointDifferential: {
    term: 'Point differential',
    definition: 'Points scored minus points allowed across the season.',
    why: 'The best one-number summary of team quality there is — it predicts what a club does next better than its own record does.',
  },
  netPointsPerGame: {
    term: 'Net points per game',
    definition: 'Point differential spread over the games actually played, so a club six weeks in can be compared with one twelve weeks in.',
    why: 'A touchdown a game clear is a genuine contender. A touchdown a game the wrong way is a top-five draft pick.',
  },
  pythagoreanWins: {
    term: 'Pythagorean wins',
    definition: 'The record a club\'s scoring says it should have, ignoring how the wins actually fell.',
    why: 'A team well above it has been winning the close ones, which is not a skill that holds. A team below it has been better than its record looks and is usually the better bet going forward.',
  },
  luck: {
    term: 'Luck',
    definition: 'Actual wins minus the wins the scoring earned.',
    why: 'Positive means you have been getting away with it; negative means you have been unlucky. Neither tends to last, which is exactly why it is worth knowing which one you are.',
  },
  srs: {
    term: 'Adjusted margin (SRS)',
    definition: 'Average scoring margin corrected for the strength of the teams that produced it, so beating good clubs counts for more than beating bad ones.',
    why: 'Twenty points covers the span from the best team in the league to the worst, so a ten-point gap makes the weaker side about a one-in-four shot. No single game counts for more than three scores.',
  },
  strengthOfSchedule: {
    term: 'Strength of schedule',
    definition: 'How hard the opposition has been — the combined record of everyone a club has actually played.',
    why: 'The context a win-loss column does not carry. 8-4 against the league\'s hardest schedule and 8-4 against its softest are not the same season.',
  },
  powerIndex: {
    term: 'Power index',
    definition: 'The composite score behind the power ranking, centred so the league average is 50.',
    why: 'It blends what a club has done with how good it actually is, so it is allowed to disagree with the standings — and the disagreement is the interesting part.',
  },
  powerRanking: {
    term: 'Power ranking',
    definition: 'An argument about who is actually good, built from results credited against opponent quality, adjusted scoring margin, roster strength and recent form.',
    why: 'Deliberately not the standings re-sorted. A 5-2 club that has escaped three times against bad teams will sit below a 4-3 club that has been battering people.',
  },
  powerMovement: {
    term: 'Movement',
    definition: 'How far a club has climbed or fallen since the last published ranking.',
    why: 'It only exists once there is an earlier week on record. Last week\'s ranking cannot be worked out after the fact — a club that signed somebody on Tuesday would rewrite its own history.',
  },
  resume: {
    term: 'Résumé',
    definition: 'Results weighed against the quality of who produced them. Beating a good side banks more than beating a bad one; losing to a good side costs less than losing to a bad one.',
  },
  recentForm: {
    term: 'Recent form',
    definition: 'The last four results, with the most recent counting most.',
  },
  recordRankGap: {
    term: 'Against the record',
    definition: 'How many places a club sits above or below where its record alone would put it.',
    why: 'A large positive number is a good team that has been unlucky. A large negative one is a record that will not survive contact with a real schedule.',
  },
  divisionSeeding: {
    term: 'Seeding',
    definition: 'Every division winner is seeded above every wild card, whatever the records say.',
    why: 'A division lead is worth more than a better record somewhere else, which is why the four games inside your own division are the ones to worry about.',
  },
  clinchStatus: {
    term: 'Clinched / eliminated',
    definition: 'Whether a club\'s postseason place is already settled — mathematically in, mathematically out, or still to be decided.',
  },
  winProbability: {
    term: 'Win chance',
    definition: 'How likely a club is to win a given game, from the two rosters and home advantage.',
    why: 'Nothing in football is a certainty: even a heavy favourite loses often enough that a season is decided by the games you were supposed to win.',
  },

  // -------------------------------------------------------------------------
  // ROSTER
  // -------------------------------------------------------------------------
  depthChart: {
    term: 'Depth chart',
    definition: 'The order players take the field at each position. The man at the top starts.',
    why: 'It is not sorted for you. A better player buried behind a worse one is minutes you are simply throwing away.',
  },
  starter: {
    term: 'Starter',
    definition: 'A player at the top of the depth chart at his position — the eleven on offence and eleven on defence who take the first snap.',
  },
  expiringContract: {
    term: 'Expiring',
    definition: 'A contract with no seasons left after this one. Unless he is re-signed or tagged, he reaches free agency.',
    why: 'Roughly a quarter of a roster expires every year. Deciding which quarter to keep is most of the job.',
  },
  rosterNeed: {
    term: 'Need',
    definition: 'A position where the roster is short of bodies, short of quality, or both.',
    why: 'A need is not the same as a hole in the starting lineup — a position with a good starter and nobody behind him is one hamstring from being your biggest problem.',
  },
  injuryStatus: {
    term: 'Injury status',
    definition: 'Whether a player is available. An injured man does not take the field and does not come off your cap.',
  },

  // -------------------------------------------------------------------------
  // TRADES
  // -------------------------------------------------------------------------
  tradeValue: {
    term: 'Trade value',
    definition: 'What each side of a deal is worth to the club being asked, counting players, picks, contracts and what they already have at that position.',
    why: 'The same player is worth different amounts to different clubs. A rebuilding team pays for youth and picks; a contender pays for the man who starts on Sunday.',
  },
  tradeAcceptance: {
    term: 'Acceptance line',
    definition: 'How your offer compares with what this club needs to see. At 100% they will take it.',
    why: 'A little short and they counter. Well short and they simply decline — there is no amount of asking that turns a bad offer into a good one.',
  },
  gmPhilosophy: {
    term: 'Front office philosophy',
    definition: 'Where a club sees itself — rebuilding, competing, or somewhere between.',
    why: 'It changes what they will pay for. A rebuilding club values youth and draft capital over immediate roster quality; a contender will pay a premium for the opposite.',
  },

  // -------------------------------------------------------------------------
  // DYNASTY / GM CAREER
  // -------------------------------------------------------------------------
  dynastyScore: {
    term: 'Franchise dynasty score',
    definition: 'One number for a club\'s whole body of work — titles, playoff runs, win rate, draft record, cap discipline, individual awards and league records held, counted back to its first season on record.',
    why: 'It rates the franchise, not the man running it: a title won two decades before you were hired still sits in that cabinet and still counts here. Your own record is the line under your club\'s name; your Dynasty level grades that. Championships dominate the club figure, at 25 points each against 5 for a playoff trip, and the breakdown is on every row.',
  },
  gmLevel: {
    term: 'Dynasty level',
    definition: 'Your standing as a general manager, earned from what the club achieves while you are in the chair — nothing from before you were hired counts toward it.',
    why: 'The first level costs about a good half-season; level 20 is around three titles\' worth of work.',
  },
  gmXp: {
    term: 'XP',
    definition: 'Earned for results — wins, playoff runs, titles, awards, picks that turn into players. Never for repeating an action.',
    why: 'A championship is worth roughly seventy regular-season wins, because a career spent grinding out 9-8 seasons should not out-earn actually winning something. There is nothing here to farm.',
  },
  skillPoints: {
    term: 'Skill points',
    definition: 'What a Dynasty level buys. They pay for information and tools — never for better players.',
    why: 'There are about ten to earn by level 30 against twenty needed to fill the tree, so you are choosing what kind of GM you are rather than eventually having everything.',
  },
  skillTree: {
    term: 'Skill branches',
    definition: 'Three lines of upgrade — scouting, negotiation and player development. No prerequisites; spend where you like.',
    why: 'Nothing in here touches a rating, a player\'s development or a game result. A level 50 GM and a level 1 GM play the same football; the level 50 one just sees more of it.',
  },
  gmBadge: {
    term: 'GM badge',
    definition: 'A reputation earned from decisions already on your record — every one of them backed by a number you can go and check.',
  },

  // -------------------------------------------------------------------------
  // HONOURS
  // -------------------------------------------------------------------------
  allStar: {
    term: 'All-Star',
    definition: 'A selection earned by being one of the best at your position over a season. Chosen from what a player actually did, never from his rating.',
  },

  // -------------------------------------------------------------------------
  // THE ANALYTICS DEPARTMENT
  // -------------------------------------------------------------------------
  // Everything the department derives rather than counts. Every benchmark
  // quoted below was measured off a played season in this game, not carried
  // over from the real sport — see the note at the head of this file.
  unitSpendShare: {
    term: 'Share of salary',
    definition: 'How much of your active salary goes to one position group — every cap dollar charged to the men in that room, against what the whole roster costs.',
    why: 'The dollar figure alone says nothing; a quarterback room is meant to be expensive. What matters is whether the share matches what the unit gives back.',
  },
  unitSpendVsLeague: {
    term: 'Spend against the league',
    definition: 'Your share of salary at a unit minus the average share across all thirty-two clubs, in percentage points.',
    why: 'Four points more at one unit has to come out of another. This is the column that tells you which room you have decided matters most — whether you meant to or not.',
  },
  unitRatingVsLeague: {
    term: 'Rating against the league',
    definition: 'What your unit rates minus what the same unit rates on average across the league.',
    why: 'Units spread far wider than whole teams do: the best and worst quarterback rooms can sit forty points apart while every roster in the league fits inside twenty. Two points at a unit is noise, ten is a different football team.',
  },
  unitWeight: {
    term: 'Share of team quality',
    definition: 'How much of a club\'s overall rating one unit carries. The quarterback room carries a fifth of it, the defensive line and the secondary about a sixth each, the tight ends three percent.',
    why: 'It is why an elite kicker barely moves a roster rating and an ordinary quarterback drags it down. Spend where the weight is.',
  },
  oneScoreGame: {
    term: 'One-score game',
    definition: 'A game decided by eight points or fewer — a touchdown and a two-point conversion, so the losing side finished one possession from level.',
    why: 'About a third of this league\'s games end this way. A good roster with a losing record in them has a fourth-quarter problem rather than a talent problem, and it is not the sort of thing that repeats.',
  },
  blowoutGame: {
    term: 'Blowout',
    definition: 'A game decided by twenty-eight or more — four scores, and settled long before the end.',
    why: 'Winning them says the gap in rosters was real. Losing them is the one result nobody can pin on the last possession.',
  },
  blownLead: {
    term: 'Lead surrendered',
    definition: 'A defeat in a game you led by ten or more at some point, read off how the drives actually went rather than off the final score.',
    why: 'The scoreline hides these completely. A club dropping several is losing games it had already won, which points at the fourth quarter and the defence rather than at the roster.',
  },
  gameShape: {
    term: 'Game shape',
    definition: 'How a game actually went, drive by drive: a comeback, a collapse, a see-saw, a one-score finish, never in doubt, wire to wire, never led, pulled away, slipped away or a stalemate.',
    why: 'Two 24-17 wins can be entirely different afternoons. The shape is the half of a result the scoreline throws away.',
  },
  contractSurplus: {
    term: 'Surplus',
    definition: 'What a player is worth on the open market minus what he costs your cap this season. Positive and you have him under the going rate; negative and you are paying over it.',
    why: 'Most bargains are young men on rookie deals and most overpays are good players two years past their best season. Neither is a mistake on its own — but a roster with no surplus anywhere has no room to add.',
  },
  ageCliff: {
    term: 'The cliff',
    definition: 'Thirty — the age at which a starter\'s decline is worth planning around rather than hoping about.',
    why: 'Look two years ahead rather than at today. A first-teamer who is 28 now is over it by the time his current deal runs out, and that is the offseason you needed his replacement already drafted.',
  },
  leagueMeanRating: {
    term: 'League mean rating',
    definition: 'The average rating of every player on a roster in this league — around 65.',
    why: 'It sits below starter level because most of a 53-man roster is depth. A pick that clears the line is a footballer; a pick up around 70 is a starter.',
  },
  scheduleAhead: {
    term: 'Opponents left',
    definition: 'The combined win rate of the clubs still on your schedule, from the records they have so far.',
    why: 'Set it against the opponents you have already played. A club that banked its wins against the soft half of the schedule is about to find out.',
  },
  projectedFinish: {
    term: 'Projected finish',
    definition: 'Your record so far plus the win chance of every game left, added together. Not a call on which ones you win — the sum of how likely each one is.',
    why: 'The honest version of "we need to go 4-2". It says what an ordinary run of results gets you, so you can see whether the season needs rescuing or just finishing.',
  },
  gamesBehind: {
    term: 'Games back',
    definition: 'How far off the division lead a club is: the gap in wins and the gap in losses, halved.',
    why: 'It counts both halves of the gap, which is why it moves so slowly — taking a game back needs a win by you and a defeat by them. A three-game lead in December is close to over.',
  },
  draftRoundReturn: {
    term: 'Draft return',
    definition: 'What each round of your board has produced, measured by what those players rate today rather than by what anyone graded them on draft day.',
    why: 'If the board is worth anything the rounds separate — first-rounders above second-rounders, and on down. Where they do not, the room is not seeing what it thinks it sees.',
  },
  productionCurve: {
    term: 'Production curve',
    definition: 'A player\'s headline number season by season — passing yards for a quarterback, sacks for a rusher, tackles for a linebacker — over completed regular seasons only.',
    why: 'What you are looking for is the line flattening while the cap hit above it climbs. That is the shape of a contract you are about to regret, and it shows up a year before the rating does.',
  },
  rateQualifier: {
    term: 'Qualifier',
    definition: 'The volume a player needs before a rate is worth quoting — attempts for a passer, carries for a back, targets for a receiver. It scales with how much of the season has been played.',
    why: 'Without it the leaderboard belongs to a receiver who caught his only target. A rate is a claim about a player; the volume behind it is how much the claim is worth.',
  },
  leagueSpread: {
    term: 'Against the league',
    definition: 'Every club\'s figure laid out together with the league average marked, so a rank arrives with the field it was earned in.',
    why: 'A rank on its own lies by omission. Seventeenth of thirty-two is a disaster if the field is spread across two points a drive and nothing at all if the whole league sits inside a tenth of one.',
  },
  driveOutcome: {
    term: 'Drive outcome',
    definition: 'How a possession ended — a touchdown, a field goal, a punt or turnover on downs, or a turnover. Drives the clock ran out on are kept out of every rate, because they never had a chance to score.',
    why: 'Read the two bars against each other. The gap between the touchdown share you produce and the one you concede is most of the scoreboard.',
  },
  pointsPerDrive: {
    term: 'Points per drive',
    definition: 'Points scored divided by drives run.',
    why: 'The cleanest single read on an offence, because it takes pace out of it — a club running twelve possessions a game and one running nine are finally comparable. The middle of this league is about 2.3; past 2.6 is a top-quarter offence and under 2.0 a bottom-quarter one.',
  },
  pointsPerDriveAllowed: {
    term: 'Points per drive allowed',
    definition: 'Points the defence gave up divided by the drives it faced.',
    why: 'The same measure from the other side and on the same scale — the league averages about 2.3 either way, because every drive one club runs is a drive another faces. Under 2.1 is a top-quarter defence.',
  },
  netPointsPerDrive: {
    term: 'Net points per drive',
    definition: 'Points per drive minus points per drive allowed — the whole club in one number.',
    why: 'It averages to zero across the league, so the sign is most of the story. A quarter of a point a drive clear is top-quarter football; the same the other way is a top-ten draft pick.',
  },
  scoringDriveRate: {
    term: 'Drives ending in points',
    definition: 'The share of drives that finished with a touchdown or a field goal.',
    why: 'A shade over 40% is the middle of this league. This is the number that separates an offence that moves the ball from one that finishes, and plenty of clubs do the first without the second.',
  },
  touchdownDriveRate: {
    term: 'Touchdown rate per drive',
    definition: 'The share of drives that finished in the end zone.',
    why: 'About 27%, against roughly 41% of drives that produce any points at all — so a third of your scoring drives stall and settle for three. Closing that gap is worth more than any yardage number on this board.',
  },
  threeAndOut: {
    term: 'Three-and-out',
    definition: 'A possession that ended in a punt or on downs inside three plays — the ball straight back, with nothing gained.',
    why: 'Around 9% of drives here. It is the cheapest thing to be bad at: the defence goes back out with no rest and the other side starts closer than it earned.',
  },
  turnoverDriveRate: {
    term: 'Turnovers per drive',
    definition: 'The share of drives that ended in a turnover.',
    why: 'Around 9% is normal. Giveaways swing games harder than anything else on this board and hold from one year to the next less than anything else on it — a club at the bad end is usually better than its record.',
  },
  yardsPerDrive: {
    term: 'Yards per drive',
    definition: 'Yards gained divided by drives run.',
    why: 'About 37 in this league. It says whether you move the ball; points per drive says whether that mattered. The clubs where the two disagree have a finishing problem.',
  },
  yardsPerPlay: {
    term: 'Yards per play',
    definition: 'Yards gained on a possession divided by the plays it took.',
    why: 'The tightest number on the board — the whole league fits between about 5.1 and 6.3, so a tenth of a yard is a real difference and half a yard is a gulf.',
  },
  driveStopRate: {
    term: 'Drives stopped without points',
    definition: 'The share of the drives your defence faced that ended with no touchdown and no field goal.',
    why: 'Around 59% is the middle here. It is the defensive twin of the scoring rate, and the fairer way to judge a defence that spends all afternoon on the field.',
  },
} as const satisfies Record<string, GlossaryTerm>;

export type GlossaryKey = keyof typeof GLOSSARY;

/**
 * The string a tooltip shows: the definition, plus the "why it matters" beat
 * where the term has earned one. One function so two screens explaining the
 * same term cannot present it differently — which is the whole reason this
 * file exists.
 */
export function tip(key: GlossaryKey): string {
  // Widened to the interface deliberately: `satisfies` keeps the literal keys,
  // which is the point, but it also keeps each entry's literal SHAPE — and a
  // term with no `why` then has no such property to read at all.
  const t: GlossaryTerm = GLOSSARY[key];
  return t.why ? `${t.definition} ${t.why}` : t.definition;
}

/** Just the definition, for the rare surface with no room for the second beat. */
export function define(key: GlossaryKey): string {
  const t: GlossaryTerm = GLOSSARY[key];
  return t.definition;
}
