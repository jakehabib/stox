'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertLeagueOwner } from '@/lib/owner';
import { draftPlayer, runAiPicksUntilUser, draftOneAiPick, currentPick, draftIsStarted } from '@/lib/draft';
import { parseSettings } from '@/lib/settings';
import { readJson } from '@/lib/json';
import { LEAGUE } from '@/lib/tuning';
import { Rng } from '@/lib/rng';

/**
 * Make the user's pick — HIS PICK, AND NOT ONE SELECTION MORE.
 *
 * The rookie contract is real cap money, so this can be refused by the salary
 * cap (see draftPlayer in lib/draft.ts) — a foreseeable, user-recoverable
 * outcome that must come back as a message rather than an uncaught throw,
 * which in Next blanks the draft screen instead of saying what happened.
 *
 * WHY THERE IS NO runAiPicksUntilUser CALL HERE ANY MORE.
 *
 * There used to be one, right after the pick landed, and the app owner
 * described exactly what it felt like: *"once again after i made my pick, it
 * just skipped to my next pick in the draft. HUGE glitch"*.
 *
 * It was doing precisely that. The user takes his man at #17 and the same
 * server round-trip runs every AI selection between there and his next turn —
 * so the board he came back to was already thirty-one picks later, and the
 * twenty-plus clubs that went in between never appeared on his screen at all.
 * The one night of the year that is supposed to be watched happened inside a
 * function call.
 *
 * LiveDraftTicker exists to pace those selections one at a time
 * (draftOneAiPickAction, one pick per tick), and this batch call was silently
 * overtaking it. The user's pick now advances the clock by exactly one
 * selection — DraftState is already advanced by draftPlayer — and the ticker
 * picks the draft back up from there. See the note about dismissal below: that
 * refresh is what re-arms it.
 *
 * "Skip ahead" is still available, but only where the owner asked for it: the
 * run button on the ticker (runDraftChunkAction), pressed on purpose.
 */
export async function draftPlayerAction(leagueId: string, playerId: string, teamId: string) {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  try {
    await draftPlayer({ leagueId, playerId, teamId, seasonYear: league.seasonYear });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'That pick could not be made.' };
  }

  /*
   * NO revalidatePath HERE, AND THAT IS THE WHOLE FIX FOR THE VANISHING CARD.
   *
   * The app owner: *"the pick confirmation popup literally pops up for a
   * microsecond before disappearing"*.
   *
   * The card is raised from inside the drafted player's own board row, which
   * is the one row guaranteed to be gone a moment after the pick. The design
   * (see DraftMomentProvider, which is where the card is actually rendered)
   * holds the board refresh until the card is dismissed, precisely so nothing
   * unmounts underneath it.
   *
   * This line then did the refresh anyway. Inside the same startTransition as
   * the action call, the revalidation lands before the card can paint, the row
   * unmounts, and the card dies in a frame. The comment described a policy the
   * code did not follow, which is the same failure this codebase treats as a
   * bug in its own right.
   *
   * Nothing goes stale, and nothing stalls: dismissing the card calls
   * router.refresh(), which re-renders the layout and every server component
   * on it. That is also the moment LiveDraftTicker sees `isUserOnClock` go
   * false and starts the next club's clock, so the draft moves on without the
   * user pressing anything else. The refresh is deferred, not dropped.
   */
  return { ok: true, message: 'Pick is in.' };
}

/**
 * Open the rookie draft. Nothing on the draft page moves until this has been
 * called: startRookieDraft (lib/draft.ts) writes DraftState with
 * `started: false` when free agency closes, so the board, the order and the
 * GM's own picks are all set and visible while the clock is still stopped.
 *
 * The owner's report was *"it autostarted without me knowing"* — the phase
 * flipped on a week advance and the ticker began burning first-round picks the
 * instant the page rendered.
 *
 * COMPARE-AND-SET, not read-then-write. Two clicks on a button that sits under
 * a full-page render is the ordinary case, not the exotic one, and this app has
 * been bitten before by both halves of a double-submit passing the same read.
 * `updateMany` with `started: false` in the WHERE is the claim: exactly one
 * caller can see count 1. A zero count means somebody already opened this
 * draft, which is a fine outcome and not an error — the answer either way is
 * "the draft is open".
 */
export async function beginRookieDraftAction(leagueId: string) {
  await assertLeagueOwner(leagueId);
  const claimed = await prisma.draftState.updateMany({
    where: { leagueId, started: false },
    data: { started: true },
  });
  revalidatePath(`/league/${leagueId}`, 'layout');
  return { ok: true, alreadyStarted: claimed.count === 0 };
}

/**
 * ===========================================================================
 * SKIPPING AHEAD, IN CHUNKS THE CLIENT DRIVES
 * ===========================================================================
 * THIS IS THE ONE PLACE SKIPPING AHEAD IS ALLOWED, and it is allowed because
 * the GM asked for it: it fires only from the run button on LiveDraftTicker,
 * when he does not want to sit through the back half of round four. Nothing
 * else may call it — draftPlayerAction used to, which is how a pick at #17
 * turned into a board sitting at #48 with nothing watched in between (see the
 * note there).
 *
 * IT USED TO BE ONE REQUEST AND THAT IS THE BUG THIS REPLACES.
 * advanceToUserPickAction called runAiPicksUntilUser once and sat on the
 * connection until the whole thing was done. The app owner, who had traded
 * every selection he had left: *"i tried to sim to the end of the draft but
 * theres no option. tried to skip to my pick and now my game is frozen on
 * 'picking....'"*. It was not frozen — it was 190-odd selections going in one
 * at a time behind a button that could not say so, and because he owned no
 * pick to stop at, runAiPicksUntilUser's `pickInfo.teamId === userTeamId`
 * break could never fire and it ran his draft to the end. He came back with
 * *"nevermind, it actually just ended randomly"*.
 *
 * So: WHERE IT STOPS is unchanged (the user's card, or the end of the board),
 * HOW FAR IT GOES PER REQUEST is now bounded, and WHO KEEPS ASKING is the
 * client, which is the only party that can put a number on the screen while it
 * happens.
 *
 * HOW MANY PICKS ONE REQUEST IS ALLOWED TO TAKE.  [TUNE]
 *
 * MEASURED (scripts/_draftsim.ts, a real 224-pick rookie draft run end to end
 * against local Postgres): 69 ms per AI selection — p50 64, p90 88, max 145 —
 * and 31.2 database round trips per selection. Locally a round trip is ~0.1 ms,
 * so essentially all of that 69 ms is compute and the round trips are free.
 * In production they are the entire bill. Same arithmetic docs/deployment.md
 * runs on league creation — a measured round-trip count times a latency, not
 * an observed production timing:
 *
 *   latency per trip        ms per pick     224 picks in ONE request
 *   2 ms  (same region)        ~128            ~29 s
 *   5 ms                       ~222            ~50 s
 *   10 ms                      ~378            ~85 s
 *   25 ms (cross-region)       ~846           ~190 s
 *
 * Every row of that is over Vercel's ~10 s default function budget, and the
 * draft page does not raise it. A request that trips the ceiling never resolves
 * the client's await, which is precisely the dead button he described.
 *
 * Each chunk is therefore bounded twice, and it needs both:
 *   CHUNK_PICKS is the "even when it is fast, let him watch it" cap. Twelve
 *     selections is about a second and a half at same-region latency, which
 *     reads as a board moving rather than a spinner.
 *   CHUNK_MS is the "when it is slow, do less" deadline, checked between
 *     selections, and it is what actually keeps the request off the ceiling.
 *     At 25 ms a chunk gives up after four or five picks instead of twelve.
 *     Worst case is the deadline plus the one pick that crossed it — 3.5 s +
 *     0.9 s ≈ 4.4 s against a 10 s ceiling, with the rest left for a cold
 *     start.
 * A count on its own is a guess about latency. A deadline on its own would run
 * two hundred picks in one request on a fast day and show him none of them.
 */
const CHUNK_PICKS = 12;
const CHUNK_MS = 3500;

/** Why a chunk stopped. Only CHUNK_FULL means "call me again". */
export type DraftRunStop = 'USER_ON_CLOCK' | 'DRAFT_COMPLETE' | 'BOARD_EMPTY' | 'CHUNK_FULL';

export interface DraftRunChunk {
  picksMade: number;
  /** The last card in, so the client has something new to show every chunk. */
  last: { teamName: string; playerName: string; position: string; round: number } | null;
  /** True when this run is over and the client should stop asking. */
  done: boolean;
  stoppedBy: DraftRunStop;
}

/**
 * Run up to a chunk's worth of AI selections and report where it got to.
 *
 * THE RUNNER TAKES NO "how far" ARGUMENT, and that is deliberate. It always
 * stops at the user's card and it always stops at the end of the board — the
 * difference between "fast forward to my pick" and "run out the draft" is
 * entirely a question of which of those two it hits first, which is a fact
 * about his DraftPick rows and not a mode to be passed in. A run that could be
 * told to blow through his own selection would have to pick a player for him,
 * and nothing in this game does that.
 */
export async function runDraftChunkAction(leagueId: string, userTeamId: string): Promise<DraftRunChunk> {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });

  const startedAt = Date.now();
  let picksMade = 0;
  let last: DraftRunChunk['last'] = null;
  let stoppedBy: DraftRunStop = 'CHUNK_FULL';
  let done = false;

  while (picksMade < CHUNK_PICKS) {
    // The deadline is checked BEFORE the pick and after at least one has
    // landed, so a chunk always makes forward progress — a client loop that
    // can receive picksMade: 0 forever is the frozen button again, wearing a
    // progress counter.
    if (picksMade > 0 && Date.now() - startedAt >= CHUNK_MS) break;

    const rng = new Rng(`draft-run-${leagueId}-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
    const result = await draftOneAiPick(leagueId, userTeamId, rng, league.seasonYear);
    if (result) { last = result; picksMade += 1; continue; }

    /*
     * draftOneAiPick answers null for three different reasons and the user is
     * owed a different sentence for each, so the one extra query to find out
     * which is worth it. It is paid ONCE PER CHUNK, at the end, rather than
     * per pick — asking currentPick() before every selection would add three
     * round trips to each one, which at cross-region latency is another 75 ms
     * a pick for information that is only ever needed on the last.
     */
    const info = await currentPick(leagueId);
    done = true;
    stoppedBy = !info ? 'DRAFT_COMPLETE' : info.teamId === userTeamId ? 'USER_ON_CLOCK' : 'BOARD_EMPTY';
    break;
  }

  /*
   * THE END OF A DRAFT IS A LEAGUE EVENT, not just an empty board. When the
   * last card goes in, lib/draft.ts runs every AI club's position-conversion
   * sweep — the moment a real front office looks at three tackles and one
   * guard and slides somebody inside. That hangs off runAiPicksUntilUser, so a
   * run that ends the draft calls it here: with the board finished it takes no
   * picks at all, it just fires the sweep, and its own comment says it is safe
   * to reach more than once.
   *
   * Not called when we stopped on the user's card — the draft is still going
   * and there is nothing to reshape yet.
   */
  if (done && stoppedBy !== 'USER_ON_CLOCK') {
    await runAiPicksUntilUser(leagueId, userTeamId, new Rng(`draft-run-end-${leagueId}`), league.seasonYear);
  }

  /*
   * ON THE CHUNK THAT ENDS THE RUN, AND NO OTHER.
   *
   * revalidatePath(..., 'layout') re-renders every server component under
   * /league/[id], and the draft page is the heaviest of them: the full class
   * on the board, the consensus read, the scouted view of every prospect.
   * Doing it on each of the twenty-odd chunks of a long run is twenty of those
   * renders for a screen that only needs to keep roughly up — and it is not
   * even how the board keeps up. LiveDraftTicker refreshes it from the client
   * about once every TICK_SECONDS while the run is going, which is the same
   * cadence a normal draft already re-renders this page at, one tick pick at a
   * time. This line is the OTHER thing: the layout-wide invalidation that the
   * roster, the cap sheet and the wire need once the run is over, and the
   * board he is left looking at is the true one.
   */
  if (done) revalidatePath(`/league/${leagueId}`, 'layout');
  return { picksMade, last, done, stoppedBy };
}

/**
 * What the GM can actually be offered right now, read off real state.
 *
 * The button that says "Fast Forward to My Pick" has to be able to keep that
 * promise, and for a GM who traded away everything he had left it could not:
 * the old one ran the draft to its end instead and told him nothing. So the
 * client asks this first and shows the one action that is true — which turns
 * on `userPicksLeft`, the selections he owns that are still AHEAD of the
 * clock. Unused rows behind the clock are not stops; counting them would put
 * the lying label straight back.
 */
export interface DraftRunStatus {
  /** False when there is nothing to run: not opened, already over, his turn. */
  live: boolean;
  /** His own selections still ahead of the clock — the stops a run can make. */
  userPicksLeft: number;
  /** Cards left on the board, his and everybody else's. */
  picksLeft: number;
  /** Where his next one is, for copy that can name the destination. */
  nextUserPick: { round: number; slot: number; overall: number } | null;
}

export async function draftRunStatusAction(leagueId: string, userTeamId: string): Promise<DraftRunStatus> {
  await assertLeagueOwner(leagueId);
  const idle: DraftRunStatus = { live: false, userPicksLeft: 0, picksLeft: 0, nextUserPick: null };

  const state = await prisma.draftState.findUnique({ where: { leagueId } });
  if (!state || state.complete || !draftIsStarted(state)) return idle;

  if (state.kind === 'FANTASY') {
    // A fantasy draft has no DraftPick rows at all — the stored order IS the
    // turn list (see currentPick), so his remaining turns are the ones left in
    // it. Without this branch every fantasy GM reads as "no picks left" and
    // gets offered a run to the end that would stall on his own turn.
    const rest = readJson<string[]>(state.order, []).slice(state.pickIndex);
    return {
      live: true,
      userPicksLeft: rest.filter((t) => t === userTeamId).length,
      picksLeft: rest.length,
      nextUserPick: null,
    };
  }

  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const rounds = parseSettings(league.settings).draftRounds;
  const picksLeft = Math.max(0, LEAGUE.TEAM_COUNT * rounds - state.pickIndex);

  const mine = await prisma.draftPick.findMany({
    where: { leagueId, year: league.seasonYear, ownerTeamId: userTeamId, used: false },
    select: { round: true, slot: true },
    orderBy: [{ round: 'asc' }, { slot: 'asc' }],
  });
  // pickIndex is the 0-based index of the card on the clock; `overall` is
  // 1-based, so his own pick that is on the clock right now counts as ahead.
  const ahead = mine
    .map((p) => ({ round: p.round, slot: p.slot, overall: (p.round - 1) * LEAGUE.TEAM_COUNT + p.slot }))
    .filter((p) => p.overall > state.pickIndex);

  return { live: true, userPicksLeft: ahead.length, picksLeft, nextUserPick: ahead[0] ?? null };
}

/**
 * One visible AI pick at a time, for a paced/live draft-day feed the client
 * calls on a timer — a no-op returning null once the user is on the clock.
 */
export async function draftOneAiPickAction(leagueId: string, userTeamId: string) {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const rng = new Rng(`draft-tick-${leagueId}-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
  const result = await draftOneAiPick(leagueId, userTeamId, rng, league.seasonYear);
  revalidatePath(`/league/${leagueId}`, 'layout');
  return result;
}

export async function toggleShortlistAction(leagueId: string, teamId: string, playerId: string) {
  await assertLeagueOwner(leagueId);
  const existing = await prisma.shortlistEntry.findUnique({ where: { playerId_teamId: { playerId, teamId } } });
  if (existing) {
    await prisma.shortlistEntry.delete({ where: { id: existing.id } });
  } else {
    await prisma.shortlistEntry.create({ data: { playerId, teamId } });
  }
  revalidatePath(`/league/${leagueId}/draft`);
  return { shortlisted: !existing };
}
