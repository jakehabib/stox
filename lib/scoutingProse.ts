import { Rng } from './rng';
import { Position } from './tuning';
import { POSITION_WEIGHTS, ratingTier } from './ratings';
import { ScoutedAttr, ScoutedPlayerView } from './scouting';

/**
 * ===========================================================================
 * SCOUTING REPORT PROSE
 * ===========================================================================
 * Turns a ScoutedPlayerView (lib/scouting.ts) into a few sentences a scout
 * would actually write. Same pattern as lib/sim/recap.ts: pick a FRAME from
 * the shape of the data, then assemble sentences from template pools with
 * an Rng for phrase variety.
 *
 *   generateScoutingReport({ playerId, position, age, experience, isDraftee, view })
 *     -> string
 *
 * The one rule that matters: everything below reads from `view` — the
 * fogged range/observed/confidence the user is entitled to see — never
 * from trueAttrs/trueOvr/potential/devTrait. Confidence and per-attribute
 * band width (view.attrs[i].high - .low) are what drive how hedged the
 * language gets; a wide band gets a hedge, a tight one gets a flat
 * statement, regardless of how the underlying number happens to look.
 * Deterministic: seeded from playerId only, so re-rendering the same
 * player's card never reshuffles his report.
 * ===========================================================================
 */

export interface ScoutingProseInput {
  playerId: string;
  position: Position;
  age: number;
  experience: number;
  isDraftee?: boolean;
  view: ScoutedPlayerView;
}

// --- band-width language thresholds [TUNE] --------------------------------
// A displayed range's width is the ONE honest signal of how much a sentence
// is allowed to assert. These are calibrated against errorBand()'s output
// (roughly 2-24 rating points depending on confidence and attribute
// difficulty, see lib/scouting.ts) rather than against confidence directly,
// since two attributes at the same confidence can still be known to very
// different precision (a stopwatch 40 time vs. "decision making").
const TIGHT_ATTR = 5;
const MODERATE_ATTR = 11;
const WIDE_ATTR = 18;
// Same idea for the OVR/potential ranges, which run narrower than a single
// attribute band because weighted-averaging cancels out some per-attribute noise.
const TIGHT_BAND = 4;

// --- confidence tiers [TUNE] -----------------------------------------------
// Mirrors scoutNote()'s buckets in lib/scouting.ts (85/65/40/20) on purpose —
// two files describing the same confidence number should agree on what
// "solid" or "early" means.
type Tier = 'COMPLETE' | 'SOLID' | 'PARTIAL' | 'EARLY' | 'BARE';

function confidenceTier(confidence: number): Tier {
  if (confidence >= 85) return 'COMPLETE';
  if (confidence >= 65) return 'SOLID';
  if (confidence >= 40) return 'PARTIAL';
  if (confidence >= 20) return 'EARLY';
  return 'BARE';
}

const POSITION_NOUN: Record<Position, string> = {
  QB: 'quarterback', RB: 'running back', WR: 'receiver', TE: 'tight end',
  LT: 'left tackle', LG: 'left guard', C: 'center', RG: 'right guard', RT: 'right tackle',
  EDGE: 'edge rusher', DT: 'interior lineman', LB: 'linebacker', CB: 'cornerback', S: 'safety',
  K: 'kicker', P: 'punter',
};

// Natural running-prose phrasing for each attribute key — the catalogue
// labels in ratings.ts (e.g. "Man Coverage") read fine in a UI list but
// title-case awkwardly mid-sentence.
const ATTR_PHRASE: Record<string, string> = {
  speed: 'straight-line speed', acceleration: 'burst', agility: 'change of direction',
  strength: 'raw power', durability: 'durability', stamina: 'stamina',
  awareness: 'awareness', workEthic: 'work ethic', football_iq: 'football IQ',
  armStrength: 'arm strength', accuracy: 'short-area accuracy', deepAccuracy: 'deep-ball touch',
  pocket: 'pocket presence', decision: 'decision-making',
  carrying: 'ball security', elusiveness: 'elusiveness', power: 'contact balance',
  vision: 'vision', catching: 'hands', route: 'route running', release: 'release off the line',
  contested: 'ball skills in traffic',
  runBlock: 'run blocking', passBlock: 'pass protection', footwork: 'footwork',
  passRush: 'pass rush', runStop: 'run defense', blockShed: 'block shedding',
  pursuit: 'pursuit', tackling: 'tackling',
  coverage: 'man coverage', zone: 'zone coverage', press: 'press coverage', ballHawk: 'ball skills',
  kickPower: 'leg strength', kickAccuracy: 'accuracy',
};

function phraseFor(a: ScoutedAttr): string {
  return ATTR_PHRASE[a.key] ?? a.label.toLowerCase();
}

function bandWidth(a: ScoutedAttr): number {
  return a.high - a.low;
}

function cap(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** "a Starter" vs "an Elite" — the only tier label that needs it, but hardcoding "a" reads as a typo the instant a bad grade lands on it. */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/**
 * Trailing hedge clause, sized to how wide the displayed range still is —
 * never to the underlying value. The standout and weak-trait sentences in
 * one report often land in the same band tier (attribute difficulty only
 * has so many distinct values), so each tier needs more than one phrasing
 * or two sentences back-to-back read as an obvious repeat.
 */
function hedgeFor(band: number, rng: Rng): string {
  if (band <= TIGHT_ATTR) return '';
  if (band <= MODERATE_ATTR) {
    return rng.pick([
      ', and that grade is fairly settled',
      ", and it isn't likely to move much from here",
      ', with only a little room left to move',
    ]);
  }
  if (band <= WIDE_ATTR) {
    return rng.pick([
      ", though there's still a real range on the number",
      ", but there's real spread on that grade too",
      ', with more film needed to pin it down exactly',
    ]);
  }
  return rng.pick([
    ', but treat that as a first impression — the file is still thin there',
    ", though at this point that's still mostly a hunch",
    ', and a much bigger sample could easily move it',
  ]);
}

function standoutDescriptor(v: number): string {
  if (v >= 90) return 'elite, full stop';
  if (v >= 80) return 'a legitimate plus tool';
  if (v >= 70) return 'solid, a real asset';
  if (v >= 60) return "his best grade, even if it's nothing special";
  return "his ceiling right now, and that's the concern";
}

function weaknessDescriptor(v: number): string {
  if (v <= 45) return 'a real hole in the profile';
  if (v <= 55) return 'a legitimate concern';
  if (v <= 65) return 'a step behind the rest of his game';
  return 'the one grade that lags the others';
}

/**
 * Attributes that actually define this position, not merely present in its
 * weight map — a cornerback's tackling grade (weight 0.04) is real, but
 * calling it his "standout tool" reads like the report doesn't know what a
 * corner's job is. Keeping only attributes within reach of the position's
 * heaviest weight is a cheap proxy for "what a scout would actually talk
 * about" without hardcoding an archetype list per position.
 */
function relevantAttrs(position: Position, attrs: ScoutedAttr[]): ScoutedAttr[] {
  const weights = POSITION_WEIGHTS[position];
  const maxWeight = Math.max(...Object.values(weights));
  const core = attrs.filter((a) => (weights[a.key] ?? 0) >= maxWeight * 0.35);
  if (core.length > 0) return core;
  const anyWeighted = attrs.filter((a) => weights[a.key] != null);
  return anyWeighted.length > 0 ? anyWeighted : attrs;
}

function openingLine(tier: Tier, noun: string, view: ScoutedPlayerView, rng: Rng): string {
  if (tier === 'BARE') {
    return rng.pick([
      `Limited viewing on this ${noun} so far; the tools flash but the tape is thin.`,
      `Barely scouted — anything said about this ${noun} right now is closer to a guess than a grade.`,
      `Not enough exposure yet to say much with real confidence about this ${noun}.`,
      `We have laid eyes on this ${noun} twice. That is not an evaluation, it is an impression.`,
      `Thin file on this ${noun}. What is in it looks fine; there is just not much of it.`,
      `Our book on this ${noun} is close to empty and we would not pretend otherwise.`,
      `Early days with this ${noun} — we know the measurables and very little of the player.`,
      `One live look at this ${noun} and a stack of second-hand notes. Treat accordingly.`,
      `Nobody in the building has spent real time on this ${noun} yet.`,
      `Preliminary only. This ${noun} has not had a proper cross-check.`,
      `We can describe this ${noun}. We cannot yet tell you whether he can play.`,
    ]);
  }

  const ovrBand = view.ovrHigh - view.ovrLow;
  const lowT = ratingTier(view.ovrLow).label;
  const highT = ratingTier(view.ovrHigh).label;

  if (ovrBand <= TIGHT_BAND) {
    return rng.pick([
      `The file is basically closed on this ${noun} — grades out right around ${view.scoutedOvr}.`,
      `We know what this ${noun} is at this point: ${article(lowT)} ${lowT}-caliber player, and that read isn't moving much.`,
    ]);
  }
  if (lowT === highT) {
    return rng.pick([
      `Solid read on this ${noun}: everything points to ${lowT} tier, even with the exact number still settling.`,
      `Consistent evaluation on this ${noun} so far — comes back ${lowT} tier from every angle.`,
    ]);
  }
  return rng.pick([
    `Still a range on this ${noun} — anywhere from ${article(lowT)} ${lowT} to ${article(highT)} ${highT}, depending how the rest of the file fills in.`,
    `This ${noun} grades somewhere between ${lowT} and ${highT} right now; the picture isn't finished.`,
  ]);
}

function bareTraitLine(a: ScoutedAttr, rng: Rng): string {
  const phrase = phraseFor(a);
  return rng.pick([
    `The one thing with any real sample behind it — ${phrase} — checks out fine; everything else is projection.`,
    `Early testing gives us a read on ${phrase} at least; the rest of the profile is still a blank page.`,
    `${cap(phrase)} is about the only grade worth repeating out loud at this stage.`,
    `We have ${phrase} on file and precious little else.`,
    `${cap(phrase)} is the one box we can tick honestly right now.`,
    `Everything we would put our name to comes back to ${phrase}.`,
    `Outside of ${phrase}, we are guessing and we would say so in the room.`,
    `${cap(phrase)} is measurable; the football questions are all still open.`,
    `One data point worth the paper — ${phrase} — against a lot of blank space.`,
    `If you asked us to defend one grade today it would be ${phrase}.`,
    `${cap(phrase)} reads clean. Beyond that we would be selling you a hunch.`,
  ]);
}

function standoutLine(a: ScoutedAttr, rng: Rng): string {
  const phrase = phraseFor(a);
  const desc = standoutDescriptor(a.observed);
  const hedge = hedgeFor(bandWidth(a), rng);
  return rng.pick([
    `The standout tool is ${phrase} — ${desc}${hedge}.`,
    `What jumps off the tape is ${phrase}: ${desc}${hedge}.`,
    `${cap(phrase)} is the carrying trait here — ${desc}${hedge}.`,
    `He wins with ${phrase}; ${desc}${hedge}.`,
    `${cap(phrase)} is what gets him drafted and what keeps him employed — ${desc}${hedge}.`,
    `Start with ${phrase}: ${desc}${hedge}.`,
    `The calling card is ${phrase} — ${desc}${hedge}.`,
    `Everything good on this tape runs through ${phrase}, and ${desc}${hedge}.`,
    `${cap(phrase)} separates him — ${desc}${hedge}.`,
    `If he sticks it will be on ${phrase}: ${desc}${hedge}.`,
  ]);
}

function weaknessLine(a: ScoutedAttr, rng: Rng): string {
  const phrase = phraseFor(a);
  const desc = weaknessDescriptor(a.observed);
  const hedge = hedgeFor(bandWidth(a), rng);
  return rng.pick([
    `On the other side, ${phrase} is ${desc}${hedge}.`,
    `The soft spot is ${phrase} — ${desc}${hedge}.`,
    `Where it comes apart a bit is ${phrase}, ${desc}${hedge}.`,
    `The obvious question is ${phrase}: ${desc}${hedge}.`,
    `You have to live with ${phrase} — ${desc}${hedge}.`,
    `${cap(phrase)} is the part that will get him benched, ${desc}${hedge}.`,
    `He gives it back with ${phrase}; ${desc}${hedge}.`,
    `The hole in the profile is ${phrase} — ${desc}${hedge}.`,
    `What a coordinator will scheme around is ${phrase}, ${desc}${hedge}.`,
    `${cap(phrase)} is well behind the rest of it — ${desc}${hedge}.`,
  ]);
}

function roundedLine(rng: Rng): string {
  return rng.pick([
    'A well-rounded profile without one obvious carrying tool or one obvious hole.',
    'No standout trait and no glaring weakness — steady across the board.',
    "Nothing separates itself either way; it's an even profile top to bottom.",
    'Even across the board. He will not lose you a game and he will not win you one on his own.',
    'The grades sit on top of each other — a professional, unspectacular profile.',
    'No tool to build a package around, and nothing you have to hide either.',
    'Balanced to the point of being hard to write about, which is its own kind of compliment.',
    'You would struggle to name his best trait, and equally struggle to name his worst.',
    'A flat profile — competent everywhere, exceptional nowhere.',
  ]);
}

function arcLine(age: number, experience: number, isDraftee: boolean | undefined, rng: Rng): string {
  if (isDraftee || experience === 0) {
    return rng.pick([
      `He's never taken an NFL snap — this is projection from tape, testing, and interviews, not results.`,
      `Zero pro reps to lean on yet; the read here is closer to a hypothesis than a conclusion.`,
      `Pure projection at this stage — the NFL game will show us things college tape can't.`,
      `Everything here is forecast. He has not been hit by a professional yet.`,
      `No pro sample at all, so every number in this file is an argument rather than a fact.`,
      `The jump from his level to this one has broken better prospects. We are guessing, carefully.`,
      `Untested against pro speed, which is the only test that has ever mattered.`,
      `Draft grades are predictions. This one is no different and we would hold it loosely.`,
    ]);
  }
  if (age <= 23) {
    return rng.pick([
      `Still just ${age} and early in year ${experience} — real physical development is still ahead of him.`,
      `At ${age}, he's got time on his side; whatever this is now is a floor, not a finished product.`,
    ]);
  }
  if (age <= 27) {
    return rng.pick([
      `${age} years old and right in the window where most players make their biggest jump.`,
      `Squarely in the heart of a normal development curve at ${age}.`,
      `At ${age} he is in the years where the good ones separate themselves.`,
      `${age} — old enough to be trusted, young enough to still be climbing.`,
      `He is ${age}. Whatever he becomes, he is becoming it now.`,
      `Prime years. At ${age} there should be no more excuses about experience.`,
      `${age} years old, past the learning curve and into the part that counts.`,
      `Right in the meat of a career at ${age}; this is close to what you are buying.`,
    ]);
  }
  if (age <= 31) {
    return rng.pick([
      `${age} and established — whatever growth was coming has mostly already happened.`,
      `At ${age}, this is close to as good as it gets; don't bank on much more projection upward.`,
    ]);
  }
  return rng.pick([
    `${age} years old — the physical tools are the thing to watch from here, not the ceiling.`,
    `On the back half of the career at ${age}; the live question now is how much longer, not how much better.`,
  ]);
}

function ceilingLine(view: ScoutedPlayerView, rng: Rng): string {
  const band = view.potHigh - view.potLow;
  const lowT = ratingTier(view.potLow).label;
  const highT = ratingTier(view.potHigh).label;

  if (band <= TIGHT_BAND) {
    return rng.pick([
      `The ceiling reads clearly at this point: ${lowT} tier, not much argument left about it.`,
      `We've mostly settled on the upside here — ${lowT} tier — after this much film.`,
    ]);
  }
  if (lowT === highT) {
    return rng.pick([
      `Still some fog around the exact number, but every read on the ceiling comes back ${lowT} tier.`,
    ]);
  }
  return rng.pick([
    `The ceiling is the real question mark — anywhere from ${lowT} to ${highT} tier depending who you ask.`,
    `Evaluators split on the upside: some see ${article(highT)} ${highT}, others land on ${article(lowT)} ${lowT}.`,
  ]);
}

/** Only worth saying out loud when the range is tight enough to trust it — a wide-open durability band is noise, not a flag. */
function durabilityLine(view: ScoutedPlayerView, rng: Rng): string | null {
  const dur = view.attrs.find((a) => a.key === 'durability');
  if (!dur || dur.observed > 55 || bandWidth(dur) > MODERATE_ATTR) return null;
  return rng.pick([
    'One more thing worth flagging: the medical/durability file is a real concern.',
    'Durability is the other red flag in the profile — worth tracking before committing long-term.',
  ]);
}

/**
 * Build a short written scouting report from a fogged view. Pure and
 * deterministic — same inputs, same string, every time.
 */
export function generateScoutingReport(input: ScoutingProseInput): string {
  const { playerId, position, age, experience, isDraftee, view } = input;
  const rng = new Rng(`${playerId}:scouting-prose`);
  const noun = POSITION_NOUN[position] ?? position.toLowerCase();
  const tier = confidenceTier(view.confidence);

  const sentences: string[] = [openingLine(tier, noun, view, rng)];

  if (tier === 'BARE') {
    // Barely scouted: no strengths/weaknesses breakdown to offer, just
    // whichever single grade actually has a sample behind it, plus the arc.
    const pool = relevantAttrs(position, view.attrs);
    // Draw from the three best-known traits rather than always naming the
    // single tightest. The fog tends to reveal the same measurable first, so
    // "the tightest band" was the same attribute for most of the league and
    // every barely-scouted report opened by discussing speed. Any of the
    // three is honest — they are all genuinely the best-known grades on file.
    const known = [...pool].sort((a, b) => bandWidth(a) - bandWidth(b)).slice(0, 3);
    sentences.push(bareTraitLine(rng.pick(known), rng));
    sentences.push(arcLine(age, experience, isDraftee, rng));
    return sentences.join(' ');
  }

  const pool = relevantAttrs(position, view.attrs);
  const byObserved = [...pool].sort((a, b) => b.observed - a.observed);
  const best = byObserved[0];
  const worst = byObserved[byObserved.length - 1];

  if (best.observed - worst.observed < 10) {
    sentences.push(roundedLine(rng));
  } else {
    sentences.push(standoutLine(best, rng));
    sentences.push(weaknessLine(worst, rng));
  }

  sentences.push(arcLine(age, experience, isDraftee, rng));
  sentences.push(ceilingLine(view, rng));

  const durability = durabilityLine(view, rng);
  if (durability) sentences.push(durability);

  return sentences.join(' ');
}
