/**
 * ===========================================================================
 * THE MUTATION SURFACE, AUDITED FROM THE OUTSIDE
 * ===========================================================================
 *   npm run audit:actions
 *
 * A Server Action is a public POST endpoint. The button that calls it, the
 * page that greys it out and the type on its signature are all presentation;
 * the only thing standing between one player's save and another's is what the
 * function itself checks on the way in. This walks EVERY exported action in
 * app/actions/** AND EVERY EXPORTED HTTP METHOD of every route handler in
 * app/api/** and proves three things about each:
 *
 *   1. OWNERSHIP.  Called by someone holding a different save's credential, it
 *      refuses — before it reads or writes anything.
 *   2. MEMBERSHIP. Called with the caller's OWN league id but an id belonging
 *      to another save (a player, a club, an offer, a trade asset), it refuses.
 *      This is the one that is easy to miss: `assertLeagueOwner` proves the
 *      save is yours and says nothing about the id that followed it.
 *   3. INPUT.      Handed a value outside its enum, a NaN, an Infinity, a
 *      negative, a colossal number, a wrong-shaped id or a 10MB string, it
 *      answers in the game's own words rather than throwing a database error
 *      at the browser.
 *
 * IT DISCOVERS THE SURFACE RATHER THAN LISTING IT. Every exported async
 * function in app/actions/** is read off the source, and an action with no
 * entry in COVERAGE below is a FAILURE, not a skip. That is the property this
 * file exists for: the next action somebody adds without a guard fails this
 * audit on the day it is added, without anyone remembering to come here.
 *
 * ROUTE HANDLERS ARE DISCOVERED THE SAME WAY, and they were the blind spot
 * this audit shipped with. `app/api/**` is walked on the filesystem, every
 * `route.ts` is read, and every export whose name is an HTTP method becomes a
 * surface keyed `METHOD /api/...` (directory segments verbatim, `[id]` and
 * all). A method with no entry in ROUTE_COVERAGE is a FAILURE, and an entry
 * naming a route that no longer exists is a FAILURE too — so neither adding a
 * handler nor deleting one can leave this file quietly out of date. The
 * handlers are called directly, inside the same request store the actions use
 * (see scripts/requestContext.ts), with a real NextRequest: same `cookies()`,
 * same `currentViewer()`, same ownership reads a POST would get.
 *
 * WHY IT MATTERS MORE HERE THAN FOR AN ACTION. A route handler is addressable
 * by URL from anything that can make a GET — `/api/league/export/<id>` with
 * somebody else's id is one line of curl and the response is their entire
 * save: every roster, every contract, every internal valuation in the file.
 * There is no framework-generated action id to guess and no POST body to
 * forge.
 *
 * IT CREATES ITS OWN LEAGUES AND DELETES THEM BY ID. Three of them, about 20
 * seconds each: two scratch saves (the caller's and the stranger's) and one
 * the create ROUTE builds from a hostile body, because the only honest way to
 * check what that route stores is to read back the row it wrote. The database
 * is shared, it holds real saves, and this file deliberately calls destructive
 * actions — so it never touches a league it did not make, and it cleans up by
 * the ids it collected rather than by matching on a name. Counts are scoped to
 * its own owner keys for the same reason: another workstream creating a save
 * while this runs must not fail a check.
 *
 * AND IT CARRIES POSITIVE CONTROLS. Six refusals from one endpoint are also
 * what a route that 404s everything looks like, including to its owner — so
 * the export and template cases each end with the owner's own request, which
 * must succeed. A guard that refuses everybody is a different bug, not a pass.
 *
 * THREE CANARIES, printed at the end. A test that cannot fail is not evidence:
 * (A) an assertion at a knowingly false claim, which must FAIL; (B) a read of
 * a deliberately misspelled field, which must come back undefined; (C) a real
 * read that passes. If A ever passes or B ever has a value, the harness is
 * lying and nothing above it means anything.
 * ===========================================================================
 */
import { createHash, randomBytes } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { NextRequest } from 'next/server';
import { asViewer } from './requestContext';
import { prisma } from '../lib/db';
import { createLeague } from '../lib/gen/league';

const ACTIONS_DIR = join(__dirname, '..', 'app', 'actions');
const API_DIR = join(__dirname, '..', 'app', 'api');

/** The export names Next treats as HTTP handlers. Anything else in a route file is config. */
const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

const OWNER_A = 'audit-owner-a';
const OWNER_B = 'audit-owner-b';
const AS_A = `dgm_owner=${OWNER_A}`;

/**
 * The actions with no league id to own, and therefore nothing for the two
 * ownership claims above to be about. Each is named with the guard it actually
 * has, so this list can never quietly become "the ones we gave up on":
 *
 *   signUpAction / signInAction   the credential IS the request; rate-limited
 *                                 in lib/auth.ts (registerUser, authenticate).
 *   signOutAction                 destroys whatever session the cookie names
 *                                 and nothing else.
 *   setLeaderboardVisibility /    re-read the session for themselves and
 *   changePasswordAction          refuse a signed-out caller. Exercised below.
 *   createLeagueAction            deliberately works signed out — that is the
 *                                 whole try-before-you-sign-up path. Its guard
 *                                 is assertCanCreateLeague's per-owner and
 *                                 global ceilings, not ownership of anything.
 */
const NO_LEAGUE_TO_OWN = new Map<string, string>([
  ['signUpAction', 'the credential is the request; rate-limited in lib/auth.ts'],
  ['signInAction', 'the credential is the request; rate-limited in lib/auth.ts'],
  ['signOutAction', 'destroys only the session this cookie names'],
  ['setLeaderboardVisibilityAction', 're-reads the session; signed-out callers are redirected'],
  ['changePasswordAction', 're-reads the session — exercised below'],
  ['createLeagueAction', 'signed-out by design; guarded by assertCanCreateLeague, not ownership'],
]);

interface Case {
  name: string;
  /** Runs the action. Must reject, or return a refusal result. */
  run: () => Promise<unknown>;
  /** A result object counts as a refusal when this says so. Default: any throw. */
  refusedResult?: (value: unknown) => boolean;
}

const failures: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok    ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}

/** A refusal is a throw, or a result the action itself marks as refused. */
async function expectRefusal(c: Case) {
  try {
    const value = await asViewer(AS_A, c.run);
    if (c.refusedResult?.(value)) { check(c.name, true); return; }
    check(c.name, false, `returned ${JSON.stringify(value)?.slice(0, 120)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A refusal has to be a sentence, not a database error. A Prisma message
    // is a rendered query with an absolute path in it, and it used to reach
    // the player verbatim; treat one as a failure even though it "refused".
    const raw = /Invalid `prisma|invocation in|PrismaClient|constraint (failed|violated)/i.test(message);
    check(c.name, !raw, raw ? `raw database error: ${message.replace(/\s+/g, ' ').slice(0, 90)}` : '');
  }
}

/**
 * Every exported HTTP method under app/api/**, keyed `METHOD /api/path`, with
 * the route file it came from. Read off the filesystem and the source, never
 * from a list anybody has to maintain — see the header.
 */
function discoverRouteHandlers(): Map<string, { file: string; method: string; dir: string }> {
  const found = new Map<string, { file: string; method: string; dir: string }>();
  const walk = (dir: string, url: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(child, `${url}/${entry.name}`);
      } else if (/^route\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
        const src = readFileSync(child, 'utf8');
        // `export async function GET`, `export function GET`, and the
        // `export const POST = ...` form Next also accepts.
        for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var)\s+(\w+)/gm)) {
          if (HTTP_METHODS.includes(m[1])) found.set(`${m[1]} ${url}`, { file: child, method: m[1], dir: url });
        }
      }
    }
  };
  walk(API_DIR, '/api');
  return found;
}

/**
 * A route case. `expect` returns true for a pass or a sentence saying what was
 * wrong — which is how a positive control ("my own export must actually come
 * back") sits in the same list as the refusals without a second runner.
 */
interface RouteCase {
  name: string;
  /** Cookie header the request arrives with. Defaults to A's. */
  cookie?: string;
  run: () => Promise<Response>;
  expect: (res: Response, body: string) => true | string;
}

/**
 * A refusal must not describe the system. The same rule expectRefusal applies
 * to a thrown action message, applied to a response body — a 500 carrying a
 * rendered Prisma query and an absolute path is a failure even though the
 * status code is "correct".
 */
const LEAKS_INTERNALS = /Invalid `prisma|invocation in|PrismaClient|node_modules|\/home\/|\/var\/task|at Object\.|constraint (failed|violated)/i;

async function runRouteCase(c: RouteCase) {
  let res: Response;
  let body: string;
  try {
    res = await asViewer(c.cookie ?? AS_A, c.run);
    body = await res.text();
  } catch (err) {
    // A route handler that throws is a 500 with a framework page behind it.
    check(c.name, false, `threw: ${String(err).replace(/\s+/g, ' ').slice(0, 110)}`);
    return;
  }
  if (LEAKS_INTERNALS.test(body)) {
    check(c.name, false, `body leaks internals: ${body.replace(/\s+/g, ' ').slice(0, 110)}`);
    return;
  }
  const verdict = c.expect(res, body);
  check(c.name, verdict === true, verdict === true ? '' : `${res.status}: ${verdict}`);
}

/** A NextRequest the handlers can read exactly as they read a real one. */
function request(url: string, init?: RequestInit & { headers?: Record<string, string> }): NextRequest {
  return new NextRequest(new Request(url, init as RequestInit));
}

async function main() {
  // ---------------------------------------------------------------------
  // Discover the surface
  // ---------------------------------------------------------------------
  const exported = new Map<string, string>();
  for (const file of readdirSync(ACTIONS_DIR).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(join(ACTIONS_DIR, file), 'utf8');
    for (const m of src.matchAll(/^export async function (\w+)/gm)) exported.set(m[1], file);
  }
  console.log(`\nDiscovered ${exported.size} exported actions across ${new Set(exported.values()).size} files.`);

  const routes = discoverRouteHandlers();
  console.log(`Discovered ${routes.size} route handler method(s) across ${new Set([...routes.values()].map((r) => r.file)).size} route file(s):`);
  for (const key of [...routes.keys()].sort()) console.log(`  ${key}`);
  console.log('');

  // ---------------------------------------------------------------------
  // Two scratch saves. A is the caller's; B is the stranger's.
  // ---------------------------------------------------------------------
  const created: string[] = [];
  const stamp = `audit-${Date.now()}`;
  console.log('Creating two scratch leagues (this takes ~20s each)...');
  const a = await createLeague({ name: `${stamp}-a`, userTeamAbbr: 'STL' });
  created.push(a);
  await prisma.league.update({ where: { id: a }, data: { ownerKey: OWNER_A, userId: null } });
  const b = await createLeague({ name: `${stamp}-b`, userTeamAbbr: 'DAL' });
  created.push(b);
  await prisma.league.update({ where: { id: b }, data: { ownerKey: OWNER_B, userId: null } });

  /**
   * A REAL ACCOUNT AND A REAL SESSION, because two of the surfaces below are
   * gated on one. /api/league/publish requires an account by design (see
   * lib/publication.ts for the asymmetry argument), so an audit that only ever
   * calls it signed out can prove the 401 and nothing else — not that the
   * ownership predicate is applied to the league id behind it, which is the
   * check that actually matters.
   *
   * The session is minted by writing the row this app's own sign-in writes:
   * a 32-byte token in the cookie, its SHA-256 in the table (lib/auth.ts). It
   * is NOT `createSession`, because that sets a cookie on the response and the
   * harness needs it on the REQUEST of a later, separate call.
   *
   * Deleting the user at the end cascades the session AND every code it
   * published, so this leaves nothing behind.
   */
  const sessionToken = randomBytes(32).toString('base64url');
  const auditUser = await prisma.user.create({
    data: { username: `${stamp}-user`, usernameKey: `${stamp}-user`.toLowerCase() },
    select: { id: true, username: true },
  });
  const otherUser = await prisma.user.create({
    data: { username: `${stamp}-other`, usernameKey: `${stamp}-other`.toLowerCase() },
    select: { id: true },
  });
  await prisma.session.create({
    data: {
      tokenHash: createHash('sha256').update(sessionToken).digest('hex'),
      userId: auditUser.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const AS_A_SIGNED_IN = `dgm_owner=${OWNER_A}; dgm_session=${sessionToken}`;

  try {
    const aTeam = await prisma.team.findFirstOrThrow({ where: { leagueId: a, isUser: true } });
    const aAi = await prisma.team.findFirstOrThrow({ where: { leagueId: a, isUser: false } });
    const aPlayer = await prisma.player.findFirstOrThrow({ where: { teamId: aTeam.id, status: 'ACTIVE' } });
    const bTeam = await prisma.team.findFirstOrThrow({ where: { leagueId: b, isUser: true } });
    const bAi = await prisma.team.findFirstOrThrow({ where: { leagueId: b, isUser: false } });
    const bPlayer = await prisma.player.findFirstOrThrow({ where: { teamId: bTeam.id, status: 'ACTIVE' } });

    const roster = require('../app/actions/roster');
    const league = require('../app/actions/league');
    const draft = require('../app/actions/draft');
    const trade = require('../app/actions/trade');
    const dynasty = require('../app/actions/dynasty');
    const resign = require('../app/actions/resign');
    const extension = require('../app/actions/extension');
    const scouting = require('../app/actions/scouting');

    const offer = { apy: 5_000_000, years: 3, guaranteedPct: 0.5 };
    const structure = { signingBonusPct: 0.2, voidYears: 0 };
    const refused = (v: unknown) => typeof v === 'object' && v !== null && (v as { ok?: boolean }).ok === false;

    /**
     * ONE ENTRY PER EXPORTED ACTION. The key is the function name, so a new
     * export with no entry here fails the coverage check below.
     */
    const COVERAGE: Record<string, Case> = {
      // --- league ---------------------------------------------------------
      abandonRebuildAction: { name: 'abandonRebuildAction / foreign save', run: () => league.abandonRebuildAction(b) },
      deleteLeagueAction: { name: 'deleteLeagueAction / foreign save', run: () => league.deleteLeagueAction(b) },
      advanceWeekAction: { name: 'advanceWeekAction / foreign save', run: () => league.advanceWeekAction(b) },
      getLeaguePhaseAction: { name: 'getLeaguePhaseAction / foreign save', run: () => league.getLeaguePhaseAction(b) },
      updateSettingsAction: { name: 'updateSettingsAction / foreign save', run: () => league.updateSettingsAction(b, new FormData()) },

      // --- roster ---------------------------------------------------------
      cutPlayerAction: { name: 'cutPlayerAction / foreign save', run: () => roster.cutPlayerAction(b, bPlayer.id), refusedResult: refused },
      cutImpactAction: { name: "cutImpactAction / own save, stranger's player", run: () => roster.cutImpactAction(a, bPlayer.id) },
      previewFillRosterAction: { name: 'previewFillRosterAction / foreign save', run: () => roster.previewFillRosterAction(b, bTeam.id) },
      fillRosterAction: { name: 'fillRosterAction / foreign save', run: () => roster.fillRosterAction(b, bTeam.id) },
      openNegotiationAction: { name: 'openNegotiationAction / foreign save', run: () => roster.openNegotiationAction(b, bPlayer.id, bTeam.id) },
      submitOfferAction: { name: 'submitOfferAction / foreign save', run: () => roster.submitOfferAction(b, bPlayer.id, bTeam.id, offer, structure, 'x') },
      franchiseTagImpactAction: { name: "franchiseTagImpactAction / own save, stranger's player", run: () => roster.franchiseTagImpactAction(a, bPlayer.id) },
      applyFranchiseTagAction: { name: 'applyFranchiseTagAction / foreign save', run: () => roster.applyFranchiseTagAction(b, bPlayer.id), refusedResult: refused },
      fifthYearOptionImpactAction: { name: "fifthYearOptionImpactAction / own save, stranger's player", run: () => roster.fifthYearOptionImpactAction(a, bPlayer.id) },
      fifthYearOptionAction: { name: 'fifthYearOptionAction / decision outside the enum', run: () => roster.fifthYearOptionAction(a, aPlayer.id, 'BANANA'), refusedResult: refused },
      restructureContractAction: { name: 'restructureContractAction / NaN dollars', run: () => roster.restructureContractAction(a, aPlayer.id, NaN, 0), refusedResult: refused },
      changePositionAction: { name: 'changePositionAction / position outside the table', run: () => roster.changePositionAction(a, aPlayer.id, 'NOT_A_POSITION'), refusedResult: refused },
      setDepthChartAction: {
        name: "setDepthChartAction / stranger's player onto my chart",
        run: async () => {
          await roster.setDepthChartAction(aTeam.id, aPlayer.position, [bPlayer.id]);
          return prisma.depthChartSlot.count({ where: { teamId: aTeam.id, playerId: bPlayer.id } });
        },
        refusedResult: (v) => v === 0,
      },
      autoSortDepthChartAction: { name: 'autoSortDepthChartAction / foreign club', run: () => roster.autoSortDepthChartAction(bTeam.id) },

      // --- draft ----------------------------------------------------------
      draftPlayerAction: { name: 'draftPlayerAction / foreign save', run: () => draft.draftPlayerAction(b, bPlayer.id, bTeam.id), refusedResult: refused },
      beginRookieDraftAction: { name: 'beginRookieDraftAction / foreign save', run: () => draft.beginRookieDraftAction(b) },
      runDraftChunkAction: { name: 'runDraftChunkAction / foreign save', run: () => draft.runDraftChunkAction(b, bTeam.id) },
      draftRunStatusAction: { name: 'draftRunStatusAction / foreign save', run: () => draft.draftRunStatusAction(b, bTeam.id) },
      draftOneAiPickAction: { name: 'draftOneAiPickAction / foreign save', run: () => draft.draftOneAiPickAction(b, bTeam.id) },
      toggleShortlistAction: {
        name: "toggleShortlistAction / own save, stranger's club and player",
        run: async () => {
          try { await draft.toggleShortlistAction(a, bAi.id, bPlayer.id); } catch { /* refusal is the pass */ }
          return prisma.shortlistEntry.count({ where: { teamId: bAi.id } });
        },
        refusedResult: (v) => v === 0,
      },

      // --- trade ----------------------------------------------------------
      evaluateTradeAction: { name: "evaluateTradeAction / own save, stranger's club and player", run: () => trade.evaluateTradeAction(a, bAi.id, [{ type: 'PLAYER', id: bPlayer.id }], []) },
      tradeClosersAction: { name: 'tradeClosersAction / foreign save', run: () => trade.tradeClosersAction(b, bAi.id, [], []) },
      rankTradePartnersAction: { name: 'rankTradePartnersAction / foreign save', run: () => trade.rankTradePartnersAction(b, 'QB', bTeam.id, 80) },
      executeTradeAction: { name: 'executeTradeAction / foreign save', run: () => trade.executeTradeAction(b, bTeam.id, bAi.id, [{ type: 'PLAYER', id: bPlayer.id }], []), refusedResult: refused },
      forceTradeAction: { name: 'forceTradeAction / foreign save', run: () => trade.forceTradeAction(b, bTeam.id, bAi.id, [{ type: 'PLAYER', id: bPlayer.id }], []), refusedResult: refused },
      respondToTradeOfferAction: { name: 'respondToTradeOfferAction / foreign save', run: () => trade.respondToTradeOfferAction(b, 'cmt000000000000000000000', true), refusedResult: refused },

      // --- dynasty --------------------------------------------------------
      purchaseSkillAction: { name: 'purchaseSkillAction / __proto__ as a skill id', run: () => dynasty.purchaseSkillAction(a, '__proto__'), refusedResult: refused },
      fullScoutAction: { name: 'fullScoutAction / foreign save', run: () => dynasty.fullScoutAction(b, bTeam.id, bPlayer.id), refusedResult: refused },
      fullScoutPanelAction: { name: 'fullScoutPanelAction / foreign save', run: () => dynasty.fullScoutPanelAction(b, bTeam.id, '') },
      contractEstimateAction: { name: 'contractEstimateAction / Infinity years', run: () => dynasty.contractEstimateAction(a, aPlayer.id, Infinity), refusedResult: (v) => v === null },
      tradeIntelAction: { name: "tradeIntelAction / own save, stranger's club", run: () => dynasty.tradeIntelAction(a, bAi.id, [], []) },
      insiderReadAction: { name: "insiderReadAction / own save, stranger's club", run: () => dynasty.insiderReadAction(a, bAi.id, [{ type: 'PLAYER', id: bPlayer.id }], []), refusedResult: refused },

      // --- resign / extension ---------------------------------------------
      letAiResignAction: { name: 'letAiResignAction / foreign save', run: () => resign.letAiResignAction(b) },
      openResignNegotiationAction: { name: 'openResignNegotiationAction / foreign save', run: () => resign.openResignNegotiationAction(b, bPlayer.id) },
      submitResignOfferAction: { name: 'submitResignOfferAction / foreign save', run: () => resign.submitResignOfferAction(b, bPlayer.id, offer, structure, 'x') },
      setAsideResignAction: { name: 'setAsideResignAction / foreign save', run: () => resign.setAsideResignAction(b, bPlayer.id, true) },
      openExtensionNegotiationAction: { name: 'openExtensionNegotiationAction / foreign save', run: () => extension.openExtensionNegotiationAction(b, bPlayer.id) },
      submitExtensionOfferAction: { name: 'submitExtensionOfferAction / foreign save', run: () => extension.submitExtensionOfferAction(b, bPlayer.id, offer, structure, 'x') },

      // --- scouting -------------------------------------------------------
      getWorkoutPanelAction: { name: 'getWorkoutPanelAction / foreign save', run: () => scouting.getWorkoutPanelAction(b, bTeam.id) },
      runWorkoutAction: { name: 'runWorkoutAction / foreign save', run: () => scouting.runWorkoutAction(b, bTeam.id, bPlayer.id), refusedResult: refused },
      getConsensusBoardAction: { name: 'getConsensusBoardAction / foreign save', run: () => scouting.getConsensusBoardAction(b, 2026) },
    };

    // -------------------------------------------------------------------
    // Coverage: an action nobody wrote a case for is a failure.
    // -------------------------------------------------------------------
    console.log('COVERAGE');
    for (const [name, file] of exported) {
      const why = NO_LEAGUE_TO_OWN.get(name);
      if (why) { console.log(`  ok    ${name} (${file}) — no league to own: ${why}`); continue; }
      check(`${name} (${file}) has a guard case`, name in COVERAGE, 'add one to COVERAGE in scripts/actionGuardAudit.ts');
    }

    console.log('\nEVERY ACTION REFUSES A STRANGER, A FOREIGN ID, OR HOSTILE INPUT');
    for (const name of Object.keys(COVERAGE)) {
      if (!exported.has(name)) { check(`${name} is still exported`, false, 'COVERAGE names an action that no longer exists'); continue; }
      await expectRefusal(COVERAGE[name]);
    }

    // -------------------------------------------------------------------
    // The session-guarded actions: no session means no write.
    // -------------------------------------------------------------------
    console.log('\nAN ACCOUNT ACTION REFUSES A SIGNED-OUT CALLER');
    const account = require('../app/actions/account');
    try {
      const r = await asViewer('', () => account.changePasswordAction(new FormData()));
      check('changePasswordAction / signed out', (r as { error?: string })?.error === 'Sign in first.', `returned ${JSON.stringify(r)}`);
    } catch (err) {
      check('changePasswordAction / signed out', false, String(err).slice(0, 80));
    }

    // -------------------------------------------------------------------
    // Settings: the enums and the numbers, in one hostile form post.
    // -------------------------------------------------------------------
    console.log('\nHOSTILE SETTINGS FORM IS CLAMPED, NOT STORED');
    const fd = new FormData();
    fd.set('capMode', 'BANANA');
    fd.set('difficulty', 'IMPOSSIBLE');
    fd.set('recapVerbosity', '<script>');
    fd.set('progressionSpeed', 'not-a-number');
    fd.set('injurySeverity', 'Infinity');
    fd.set('aiTradeFrequency', '1e308');
    fd.set('tradeDeadlineWeek', '-40');
    fd.set('simVariance', 'NaN');
    await asViewer(AS_A, () => league.updateSettingsAction(a, fd));
    const stored = JSON.parse((await prisma.league.findUniqueOrThrow({ where: { id: a }, select: { settings: true } })).settings);
    check('capMode stays a real mode', ['REALISTIC', 'SIMPLIFIED', 'OFF'].includes(stored.capMode), `stored ${JSON.stringify(stored.capMode)}`);
    check('difficulty stays a real difficulty', ['EASY', 'NORMAL', 'HARD'].includes(stored.difficulty), `stored ${JSON.stringify(stored.difficulty)}`);
    check('recapVerbosity stays a real setting', ['SHORT', 'NORMAL', 'DETAILED'].includes(stored.recapVerbosity), `stored ${JSON.stringify(stored.recapVerbosity)}`);
    for (const key of ['progressionSpeed', 'injurySeverity', 'aiTradeFrequency', 'tradeDeadlineWeek', 'simVariance', 'scoutingBudgetPerWeek']) {
      check(`${key} is a finite number`, Number.isFinite(stored[key]), `stored ${JSON.stringify(stored[key])}`);
    }
    check('tradeDeadlineWeek is inside the season', stored.tradeDeadlineWeek >= 1 && stored.tradeDeadlineWeek <= stored.seasonLength, `stored ${stored.tradeDeadlineWeek}`);
    check('aiTradeFrequency is a probability', stored.aiTradeFrequency >= 0 && stored.aiTradeFrequency <= 1, `stored ${stored.aiTradeFrequency}`);

    // -------------------------------------------------------------------
    // Double submit: the same action twice, at once, must not spend twice.
    // -------------------------------------------------------------------
    console.log('\nFIRED TWICE AT ONCE, A SCARCE THING IS SPENT ONCE');
    const targets = await prisma.player.findMany({ where: { leagueId: a }, orderBy: { trueOvr: 'desc' }, take: 2, select: { id: true } });
    await prisma.dynastyProfile.upsert({
      where: { leagueId: a },
      create: { ownerKind: 'LEAGUE', ownerKey: a, leagueId: a, fullScoutYear: 0, fullScoutUsed: 0 },
      update: { fullScoutYear: 0, fullScoutUsed: 0 },
    });
    const scouts = await Promise.allSettled([
      asViewer(AS_A, () => dynasty.fullScoutAction(a, aTeam.id, targets[0].id)),
      asViewer(AS_A, () => dynasty.fullScoutAction(a, aTeam.id, targets[1].id)),
    ]);
    const spent = scouts.filter((r) => r.status === 'fulfilled' && (r.value as { ok?: boolean }).ok).length;
    const ledger = await prisma.dynastyProfile.findUnique({ where: { leagueId: a }, select: { fullScoutUsed: true } });
    check('Full Scout charges match reveals', spent === (ledger?.fullScoutUsed ?? -1), `${spent} reveals against ${ledger?.fullScoutUsed} charges`);

    const star = await prisma.player.findFirstOrThrow({ where: { leagueId: a, isDraftee: false, teamId: { not: null } }, select: { id: true } });
    await prisma.shortlistEntry.deleteMany({ where: { teamId: aTeam.id, playerId: star.id } });
    const toggles = await Promise.allSettled([
      asViewer(AS_A, () => draft.toggleShortlistAction(a, aTeam.id, star.id)),
      asViewer(AS_A, () => draft.toggleShortlistAction(a, aTeam.id, star.id)),
    ]);
    check('two shortlist clicks at once neither throw', toggles.every((r) => r.status === 'fulfilled'),
      toggles.map((r) => (r.status === 'rejected' ? String(r.reason).replace(/\s+/g, ' ').slice(0, 70) : 'ok')).join(' | '));

    // -------------------------------------------------------------------
    // THE ROUTE HANDLERS
    // -------------------------------------------------------------------
    //
    // One entry per discovered `METHOD /api/...`, so a handler nobody wrote a
    // case for fails the coverage check below. Request objects are built by
    // hand; the handler is the real exported function, called inside the real
    // request store.
    const exportRoute = require('../app/api/league/export/[id]/route');
    const createRoute = require('../app/api/league/create/route');
    const importRoute = require('../app/api/league/import/route');
    const templatesRoute = require('../app/api/league/templates/[file]/route');
    const csvRoute = require('../app/api/league/csv/route');
    const validateRoute = require('../app/api/league/validate/route');
    const publishRoute = require('../app/api/league/publish/route');
    const redeemRoute = require('../app/api/league/redeem/route');
    const { TEMPLATE_NAMES } = require('../lib/leagueCsv');

    const EXPORT_URL = (id: string) => `http://localhost/api/league/export/${encodeURIComponent(id)}`;
    const is404 = (res: Response, body: string) =>
      res.status === 404 ? true : `expected 404, body ${body.slice(0, 90)}`;

    /**
     * FOUR FIXTURE PUBLICATIONS, so the share-code cases below have something
     * real to be refused about. Inserted directly rather than through
     * `publishLeagueFile` on purpose: that function applies the per-account
     * cap, and a fixture that silently stopped being created the day the cap
     * changed would turn these cases into vacuous passes.
     *
     * The payload is a REAL export of save A, gzipped exactly as the publish
     * route gzips it, so the redemption below is a genuine round trip rather
     * than a test of a stub.
     */
    const { gzipSync } = require('zlib');
    const { exportLeagueFile, serializeLeagueFile } = require('../lib/leagueFile');
    const { summarizeLeagueFile } = require('../lib/publication');
    const { generateShareCode } = require('../lib/shareCode');

    const fixtureFile = await exportLeagueFile(a);
    const fixtureText = serializeLeagueFile(fixtureFile);
    const fixturePayload = gzipSync(Buffer.from(fixtureText, 'utf8'));
    const fixtureSummary = summarizeLeagueFile(fixtureFile);
    const publishFixture = async (userId: string, extra: Record<string, unknown> = {}) => {
      const code = generateShareCode();
      await prisma.publishedLeague.create({
        data: {
          code,
          payload: fixturePayload,
          fileBytes: Buffer.byteLength(fixtureText, 'utf8'),
          formatVersion: fixtureFile.formatVersion,
          userId,
          sourceLeagueId: a,
          ...fixtureSummary,
          ...extra,
        },
      });
      return code;
    };
    /** Live, mine, and redeemable. */
    const liveCode = await publishFixture(auditUser.id);
    /** Mine, and the DELETE positive control withdraws it. */
    const myCode = await publishFixture(auditUser.id);
    /** Another account's, which this caller may not withdraw. */
    const strangerCode = await publishFixture(otherUser.id);
    /** Mine, and already taken down — must read as "no such code". */
    const takenDownCode = await publishFixture(auditUser.id, {
      takenDownAt: new Date(),
      takedownReason: 'audit fixture',
    });

    const ROUTE_COVERAGE: Record<string, RouteCase[]> = {
      // --- export ---------------------------------------------------------
      // A GET that serialises a whole save. The id is in the URL, a cuid is
      // not a secret (it is in every URL and every exported file), so this is
      // the one surface where ownership is the ONLY thing between a stranger
      // and another player's rosters, cap sheet and internal valuations.
      'GET /api/league/export/[id]': [
        {
          name: "export / stranger's save by id",
          run: () => exportRoute.GET(request(EXPORT_URL(b)), { params: { id: b } }),
          // 404, not 403: the endpoint must not confirm which ids are real.
          expect: (res, body) => (res.status === 404 && !body.includes('dynastygm.league') ? true : `leaked a foreign save or confirmed the id: ${body.slice(0, 90)}`),
        },
        {
          name: 'export / no session, no cookie at all',
          cookie: '',
          run: () => exportRoute.GET(request(EXPORT_URL(a)), { params: { id: a } }),
          expect: (res, body) => (res.status === 404 && !body.includes('dynastygm.league') ? true : `an anonymous caller got a save: ${body.slice(0, 90)}`),
        },
        {
          name: 'export / malformed id is refused, not reported on',
          run: () => exportRoute.GET(request(EXPORT_URL("' OR 1=1 --")), { params: { id: "' OR 1=1 --" } }),
          expect: is404,
        },
        {
          name: 'export / id of the wrong shape entirely',
          run: () => exportRoute.GET(request(EXPORT_URL('../../../etc/passwd')), { params: { id: '../../../etc/passwd' } }),
          expect: is404,
        },
        {
          name: 'export / hostile query string changes nothing',
          run: () => exportRoute.GET(request(`${EXPORT_URL(b)}?ownerKey=${OWNER_A}&id=${a}&admin=1`), { params: { id: b } }),
          expect: is404,
        },
        {
          // THE POSITIVE CONTROL. Without this the five refusals above are
          // satisfied by a route that 404s everything, including the owner.
          name: 'export / my own save DOES come back (positive control)',
          run: () => exportRoute.GET(request(EXPORT_URL(a)), { params: { id: a } }),
          expect: (res, body) => {
            if (res.status !== 200) return `the owner was refused his own save`;
            let file: { kind?: string; teams?: unknown[] };
            try { file = JSON.parse(body); } catch { return 'the export was not JSON'; }
            if (file.kind !== 'dynastygm.league') return `kind was ${JSON.stringify(file.kind)}`;
            if (!Array.isArray(file.teams) || file.teams.length === 0) return 'the export carried no teams';
            return true;
          },
        },
      ],

      // --- create ---------------------------------------------------------
      // Unauthenticated BY DESIGN (try before you sign up), so the guard is
      // not ownership — it is the creation ceiling, and the shape of what a
      // caller may dictate about the league it builds.
      'POST /api/league/create': [
        {
          name: 'create / hostile body cannot dictate the settings blob',
          cookie: 'dgm_owner=audit-owner-c',
          run: () => createRoute.POST(request('http://localhost/api/league/create', {
            method: 'POST',
            body: JSON.stringify({
              name: 'x'.repeat(5_000),
              userTeamAbbr: '../../etc/passwd',
              settings: {
                // The DoS: seasonLength is handed straight to buildSchedule.
                // Kept small deliberately — a value large enough to be worth
                // attacking with would hang this audit rather than fail it if
                // the clamp ever regressed, and 40 proves the same point.
                seasonLength: 40, rosterMax: 900, draftRounds: 90,
                capMode: 'BANANA', difficulty: 'IMPOSSIBLE', leagueStart: 'NOT_A_START',
                tradeDeadlineWeek: -40, aiTradeFrequency: 1e308, simVariance: NaN,
              },
            }),
            headers: { 'content-type': 'application/json' },
          })),
          expect: () => true, // checked against the database below
        },
        {
          name: 'create / the per-owner ceiling is enforced on this route',
          run: () => createRoute.POST(request('http://localhost/api/league/create', {
            method: 'POST', body: '{}', headers: { 'content-type': 'application/json' },
          })),
          // 429 is the documented answer, and nothing may be written.
          expect: (res, body) => (res.status === 429 ? true : `the cap did not bite: ${body.slice(0, 90)}`),
        },
      ],

      // --- templates ------------------------------------------------------
      // A few kilobytes of generated constants with no league id in it, so
      // there is no ownership claim to make. What there IS is a path segment
      // that names a file, and that has to be a whitelist rather than a
      // sanitiser: the refusals below are the ones a `..` would walk through.
      'GET /api/league/templates/[file]': [
        {
          name: 'templates / a name outside the whitelist is refused',
          cookie: '',
          run: () => templatesRoute.GET(request('http://localhost/api/league/templates/secrets.csv'), { params: { file: 'secrets.csv' } }),
          expect: (res) => (res.status === 404 ? true : 'served something that is not a template'),
        },
        {
          name: 'templates / traversal is refused, not resolved',
          cookie: '',
          run: () => templatesRoute.GET(request('http://localhost/api/league/templates/x'), { params: { file: '../../../../.env' } }),
          expect: (res, body) => (res.status === 404 && !/DATABASE_URL|postgres/i.test(body) ? true : 'a traversal reached something'),
        },
        {
          name: 'templates / an absolute path is refused',
          cookie: '',
          run: () => templatesRoute.GET(request('http://localhost/api/league/templates/x'), { params: { file: '/etc/passwd' } }),
          expect: (res, body) => (res.status === 404 && !body.includes('root:') ? true : 'an absolute path reached something'),
        },
        {
          // The positive control, same role as the export one: without it the
          // three refusals above are satisfied by a route that 404s the lot.
          name: 'templates / a real template DOES come back (positive control)',
          cookie: '',
          run: () => templatesRoute.GET(request(`http://localhost/api/league/templates/${TEMPLATE_NAMES[0]}`), { params: { file: TEMPLATE_NAMES[0] } }),
          expect: (res, body) => {
            if (res.status !== 200) return 'a listed template was refused';
            if (body.length === 0) return 'the template came back empty';
            return true;
          },
        },
      ],

      // --- csv ------------------------------------------------------------
      // A pure converter: it takes three spreadsheets and hands back the
      // league file they describe. There is no league id in it and it writes
      // nothing, so there is no ownership claim to make — what there is is an
      // unauthenticated multipart endpoint that buffers its whole upload, so
      // the cases are the size ceiling and the refusals.
      'POST /api/league/csv': [
        {
          name: 'csv / a claimed size over the cap is refused before the form is buffered',
          cookie: '',
          run: () => csvRoute.POST(request('http://localhost/api/league/csv', {
            method: 'POST', body: 'x',
            headers: { 'content-type': 'text/plain', 'content-length': String(500 * 1_048_576) },
          })),
          expect: (res, body) => (res.status === 413 ? true : `expected 413, got ${body.slice(0, 90)}`),
        },
        {
          name: 'csv / an upload that is not a form is refused in words',
          cookie: '',
          run: () => csvRoute.POST(request('http://localhost/api/league/csv', {
            method: 'POST', body: 'not a multipart body', headers: { 'content-type': 'text/plain' },
          })),
          expect: (res, body) => (res.status === 400 ? true : `expected 400, got ${body.slice(0, 90)}`),
        },
        {
          name: 'csv / garbage in teams.csv is the author’s error, not a 500',
          cookie: '',
          run: () => {
            const form = new FormData();
            form.set('teams', 'not,a,team\u0000\n' + 'x'.repeat(200));
            return csvRoute.POST(request('http://localhost/api/league/csv?draftYear=NaN&classStrength=1e308', { method: 'POST', body: form }));
          },
          expect: (res, body) => (res.status === 400 ? true : `expected 400, got ${body.slice(0, 90)}`),
        },
      ],

      // --- validate -------------------------------------------------------
      // Reads a league file or a CSV bundle, runs the REAL parseLeagueFile
      // over it and answers with the refusal the import would have given.
      // There is no league id in it and it writes nothing, so there is no
      // ownership claim to make — what there is is an unauthenticated endpoint
      // that buffers up to FILE_LIMITS.MAX_BYTES, so the cases are the size
      // ceiling, the refusals, and a positive control proving a file that IS
      // legal comes back as legal. Without that last one, three refusals are
      // also what an endpoint that rejects everything looks like — which would
      // be the worse bug here, because an author would be sent to fix a file
      // that was never broken.
      'POST /api/league/validate': [
        {
          name: 'validate / a claimed size over the cap is refused before the body is read',
          cookie: '',
          run: () => validateRoute.POST(request('http://localhost/api/league/validate', {
            method: 'POST', body: '{}',
            headers: { 'content-type': 'application/json', 'content-length': String(500 * 1_048_576) },
          })),
          expect: (res, body) => (res.status === 413 ? true : `expected 413, got ${body.slice(0, 90)}`),
        },
        {
          name: 'validate / a body that is not JSON is the author’s error, in words',
          cookie: '',
          run: () => validateRoute.POST(request('http://localhost/api/league/validate', {
            method: 'POST', body: 'this is not a league file', headers: { 'content-type': 'application/json' },
          })),
          expect: (res, body) => (res.status === 400 ? true : `expected 400, got ${body.slice(0, 90)}`),
        },
        {
          name: 'validate / JSON of the wrong shape is refused without writing',
          cookie: '',
          run: () => validateRoute.POST(request('http://localhost/api/league/validate', {
            method: 'POST',
            body: JSON.stringify({ kind: 'dynastygm.league', formatVersion: 2, teams: [{ __proto__: { admin: true } }] }),
            headers: { 'content-type': 'application/json' },
          })),
          expect: (res, body) => (res.status === 400 ? true : `expected 400, got ${body.slice(0, 90)}`),
        },
        {
          name: 'validate / garbage in teams.csv is the author’s error, not a 500',
          cookie: '',
          run: () => {
            const form = new FormData();
            form.set('teams', 'not,a,team\u0000\n' + 'x'.repeat(200));
            return validateRoute.POST(request('http://localhost/api/league/validate', { method: 'POST', body: form }));
          },
          expect: (res, body) => (res.status === 400 ? true : `expected 400, got ${body.slice(0, 90)}`),
        },
        {
          // THE POSITIVE CONTROL, and it is a round trip: the caller's own
          // league is exported through the export route and the resulting file
          // is handed straight to the validator, which must call it legal.
          // Both halves are the real handlers.
          name: 'validate / a real exported league IS accepted (positive control)',
          run: async () => {
            const exported = await exportRoute.GET(request(EXPORT_URL(a)), { params: { id: a } });
            const file = await exported.text();
            return validateRoute.POST(request('http://localhost/api/league/validate', {
              method: 'POST', body: file, headers: { 'content-type': 'application/json' },
            }));
          },
          expect: (res, body) => {
            if (res.status !== 200) return `a legal league file was refused: ${body.slice(0, 120)}`;
            let data: { ok?: boolean; report?: { teams?: number; playersWritten?: number } };
            try { data = JSON.parse(body); } catch { return 'the answer was not JSON'; }
            if (data.ok !== true) return `ok was ${JSON.stringify(data.ok)}`;
            if (data.report?.teams !== 32) return `the report named ${data.report?.teams} teams`;
            if (!((data.report?.playersWritten ?? 0) > 0)) return 'the report priced the file at no players';
            return true;
          },
        },
      ],

      // --- import ---------------------------------------------------------
      // The one endpoint that turns a stranger's file into thousands of rows.
      // Refusals only here: the cheap ones, in the order the route claims to
      // apply them.
      'POST /api/league/import': [
        {
          name: 'import / a claimed size over the cap is refused before the body is read',
          run: () => importRoute.POST(request('http://localhost/api/league/import', {
            method: 'POST', body: '{}',
            headers: { 'content-type': 'application/json', 'content-length': String(500 * 1_048_576) },
          })),
          expect: (res, body) => (res.status === 413 ? true : `expected 413, got ${body.slice(0, 90)}`),
        },
        {
          name: 'import / a body that is not JSON is the author’s error, in words',
          run: () => importRoute.POST(request('http://localhost/api/league/import', {
            method: 'POST', body: 'this is not a league file', headers: { 'content-type': 'application/json' },
          })),
          expect: (res, body) => (res.status === 400 ? true : `expected 400, got ${body.slice(0, 90)}`),
        },
        {
          name: 'import / JSON of the wrong shape is refused without writing',
          run: () => importRoute.POST(request('http://localhost/api/league/import', {
            method: 'POST',
            body: JSON.stringify({ kind: 'dynastygm.league', formatVersion: 2, teams: [{ __proto__: { admin: true } }] }),
            headers: { 'content-type': 'application/json' },
          })),
          expect: (res, body) => (res.status === 400 ? true : `expected 400, got ${body.slice(0, 90)}`),
        },
        {
          name: 'import / hostile query string is refused with the body, not acted on',
          run: () => importRoute.POST(request(`http://localhost/api/league/import?name=${'n'.repeat(4_000)}&team=${encodeURIComponent('"><script>')}`, {
            method: 'POST', body: '[]', headers: { 'content-type': 'application/json' },
          })),
          expect: (res, body) => (res.status === 400 ? true : `expected 400, got ${body.slice(0, 90)}`),
        },
      ],

      // --- publish --------------------------------------------------------
      // Turns a save into a share code, which means this deployment starts
      // holding somebody's file. Two ids arrive on the two methods — a league
      // id on POST, a code on DELETE — and the cases below are about proving
      // BOTH of them belong to the caller, which is the check that
      // `assertLeagueOwner` on its own would not make.
      'POST /api/league/publish': [
        {
          name: 'publish / a signed-out caller cannot publish at all',
          run: () => publishRoute.POST(request('http://localhost/api/league/publish', {
            method: 'POST', body: JSON.stringify({ leagueId: a }), headers: { 'content-type': 'application/json' },
          })),
          expect: (res, body) => (res.status === 401 ? true : `expected 401, got ${res.status} ${body.slice(0, 90)}`),
        },
        {
          name: "publish / signed in, a stranger's save by id",
          cookie: AS_A_SIGNED_IN,
          run: () => publishRoute.POST(request('http://localhost/api/league/publish', {
            method: 'POST', body: JSON.stringify({ leagueId: b }), headers: { 'content-type': 'application/json' },
          })),
          // 404, not 403: the endpoint must not confirm which ids are real.
          expect: (res, body) => (res.status === 404 ? true : `published or confirmed a foreign save: ${res.status} ${body.slice(0, 90)}`),
        },
        {
          // The cookie holds save A and the account does not. A signed-in
          // viewer is matched on the ACCOUNT and nothing else (ownsLeague,
          // lib/owner.ts), so this must refuse even though the same request
          // carries the cookie that owns the save.
          name: 'publish / signed in, a save this cookie owns but this account does not',
          cookie: AS_A_SIGNED_IN,
          run: () => publishRoute.POST(request('http://localhost/api/league/publish', {
            method: 'POST', body: JSON.stringify({ leagueId: a }), headers: { 'content-type': 'application/json' },
          })),
          expect: (res, body) => (res.status === 404 ? true : `expected 404, got ${res.status} ${body.slice(0, 90)}`),
        },
        {
          name: 'publish / a malformed league id is refused, not reported on',
          cookie: AS_A_SIGNED_IN,
          run: () => publishRoute.POST(request('http://localhost/api/league/publish', {
            method: 'POST',
            body: JSON.stringify({ leagueId: "' OR 1=1 --" }),
            headers: { 'content-type': 'application/json' },
          })),
          expect: (res, body) => (res.status === 404 ? true : `expected 404, got ${res.status} ${body.slice(0, 90)}`),
        },
        {
          name: 'publish / a body that is not JSON is refused in words',
          cookie: AS_A_SIGNED_IN,
          run: () => publishRoute.POST(request('http://localhost/api/league/publish', {
            method: 'POST', body: 'not json', headers: { 'content-type': 'application/json' },
          })),
          expect: (res, body) => (res.status === 400 ? true : `expected 400, got ${res.status} ${body.slice(0, 90)}`),
        },
        {
          // THE POSITIVE CONTROL. Five refusals are also what a route that
          // refuses everybody looks like. Save A is handed to the audit's
          // account for the length of this one request and handed straight
          // back, so no other case sees a league with a userId on it.
          name: 'publish / my own save DOES publish (positive control)',
          cookie: AS_A_SIGNED_IN,
          run: async () => {
            await prisma.league.update({ where: { id: a }, data: { userId: auditUser.id } });
            try {
              return await publishRoute.POST(request('http://localhost/api/league/publish', {
                method: 'POST', body: JSON.stringify({ leagueId: a }), headers: { 'content-type': 'application/json' },
              }));
            } finally {
              await prisma.league.update({ where: { id: a }, data: { userId: null } });
            }
          },
          expect: (res, body) => {
            if (res.status !== 200) return `the owner was refused his own league: ${body.slice(0, 120)}`;
            let data: { code?: string; path?: string };
            try { data = JSON.parse(body); } catch { return 'the answer was not JSON'; }
            if (typeof data.code !== 'string' || data.code.length !== 10) return `code was ${JSON.stringify(data.code)}`;
            // Crockford base32, which is the alphabet minus I, L, O and U.
            if (!/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/.test(data.code)) return `code is outside the alphabet: ${data.code}`;
            if (data.path !== `/l/${data.code}`) return `path was ${JSON.stringify(data.path)}`;
            return true;
          },
        },
      ],

      'DELETE /api/league/publish': [
        {
          name: 'publish-delete / a signed-out caller cannot withdraw anything',
          run: () => publishRoute.DELETE(request('http://localhost/api/league/publish', {
            method: 'DELETE', body: JSON.stringify({ code: strangerCode }), headers: { 'content-type': 'application/json' },
          })),
          expect: (res, body) => (res.status === 401 ? true : `expected 401, got ${res.status} ${body.slice(0, 90)}`),
        },
        {
          name: "publish-delete / another account's code is not mine to withdraw",
          cookie: AS_A_SIGNED_IN,
          run: () => publishRoute.DELETE(request('http://localhost/api/league/publish', {
            method: 'DELETE', body: JSON.stringify({ code: strangerCode }), headers: { 'content-type': 'application/json' },
          })),
          expect: (res, body) => (res.status === 404 ? true : `expected 404, got ${res.status} ${body.slice(0, 90)}`),
        },
        {
          name: 'publish-delete / a malformed code is refused in words',
          cookie: AS_A_SIGNED_IN,
          run: () => publishRoute.DELETE(request('http://localhost/api/league/publish', {
            method: 'DELETE', body: JSON.stringify({ code: '../../etc/passwd' }), headers: { 'content-type': 'application/json' },
          })),
          expect: (res, body) => (res.status === 404 ? true : `expected 404, got ${res.status} ${body.slice(0, 90)}`),
        },
        {
          // The positive control, and the proof that rule 1 of the lifecycle
          // works: a publisher can withdraw their own code.
          name: 'publish-delete / my own code DOES go (positive control)',
          cookie: AS_A_SIGNED_IN,
          run: () => publishRoute.DELETE(request('http://localhost/api/league/publish', {
            method: 'DELETE', body: JSON.stringify({ code: myCode }), headers: { 'content-type': 'application/json' },
          })),
          expect: (res, body) => (res.status === 200 ? true : `the publisher could not withdraw his own code: ${res.status} ${body.slice(0, 90)}`),
        },
      ],

      // --- redeem ---------------------------------------------------------
      // The one route in this app that is MEANT to be called by somebody with
      // no account and no cookie, and the one where a refusal that said too
      // much would hand an attacker a map. Every miss below must answer with
      // the SAME body as every other miss.
      'POST /api/league/redeem': [
        {
          name: 'redeem / a well-formed code nobody published is refused',
          cookie: '',
          run: () => redeemRoute.POST(request('http://localhost/api/league/redeem', {
            method: 'POST', body: JSON.stringify({ code: 'ZZZZZZZZZZ' }), headers: { 'content-type': 'application/json' },
          })),
          expect: (res, body) => (res.status === 404 ? true : `expected 404, got ${res.status} ${body.slice(0, 90)}`),
        },
        {
          name: 'redeem / a malformed code is refused IDENTICALLY (no oracle)',
          cookie: '',
          run: () => redeemRoute.POST(request('http://localhost/api/league/redeem', {
            method: 'POST', body: JSON.stringify({ code: 'not a code at all' }), headers: { 'content-type': 'application/json' },
          })),
          expect: (res, body) => {
            if (res.status !== 404) return `expected 404, got ${res.status} ${body.slice(0, 90)}`;
            // The sentence is one exported constant for exactly this reason.
            if (!body.includes('No league is filed under that code')) return `a different refusal: ${body.slice(0, 120)}`;
            return true;
          },
        },
        {
          name: 'redeem / a code that was taken down is refused identically',
          cookie: '',
          run: () => redeemRoute.POST(request('http://localhost/api/league/redeem', {
            method: 'POST', body: JSON.stringify({ code: takenDownCode }), headers: { 'content-type': 'application/json' },
          })),
          expect: (res, body) => {
            if (res.status !== 404) return `expected 404, got ${res.status} ${body.slice(0, 90)}`;
            if (!body.includes('No league is filed under that code')) return `a taken-down code answered differently: ${body.slice(0, 120)}`;
            return true;
          },
        },
        {
          name: 'redeem / a body that is not JSON is refused in words',
          cookie: '',
          run: () => redeemRoute.POST(request('http://localhost/api/league/redeem', {
            method: 'POST', body: 'nope', headers: { 'content-type': 'application/json' },
          })),
          expect: (res, body) => (res.status === 400 ? true : `expected 400, got ${res.status} ${body.slice(0, 90)}`),
        },
        {
          // THE POSITIVE CONTROL, and the friction asymmetry stated as a test:
          // NO COOKIE, NO SESSION, and the league is built. If this ever
          // starts failing with a 401, the recipient's on-ramp has grown a
          // sign-up wall and the feature is gone.
          name: 'redeem / no account and no cookie DOES start the league (positive control)',
          cookie: '',
          run: () => redeemRoute.POST(request('http://localhost/api/league/redeem', {
            method: 'POST',
            body: JSON.stringify({ code: liveCode, team: 'DAL', name: `${stamp}-redeemed` }),
            headers: { 'content-type': 'application/json' },
          })),
          expect: (res, body) => {
            if (res.status !== 200) return `a recipient with no account was refused: ${res.status} ${body.slice(0, 140)}`;
            let data: { leagueId?: string };
            try { data = JSON.parse(body); } catch { return 'the answer was not JSON'; }
            if (typeof data.leagueId !== 'string' || data.leagueId.length === 0) return `leagueId was ${JSON.stringify(data.leagueId)}`;
            // Collected so the cleanup below removes it by id.
            created.push(data.leagueId);
            return true;
          },
        },
      ],
    };

    console.log('\nROUTE COVERAGE');
    for (const [key, meta] of routes) {
      const cases = ROUTE_COVERAGE[key];
      check(`${key} (${meta.file.split('/app/')[1]}) has a guard case`, Array.isArray(cases) && cases.length > 0,
        'add one to ROUTE_COVERAGE in scripts/actionGuardAudit.ts');
    }
    for (const key of Object.keys(ROUTE_COVERAGE)) {
      if (!routes.has(key)) check(`${key} still exists`, false, 'ROUTE_COVERAGE names a route handler that no longer exists');
    }

    console.log('\nEVERY ROUTE HANDLER REFUSES A STRANGER, A MALFORMED ID OR A HOSTILE BODY');
    // Scoped to THIS audit's identities, never a global count: the database is
    // shared and another workstream creating a save while this runs would fail
    // a delta that was really measuring the whole table.
    const auditOwners = [OWNER_A, OWNER_B, 'audit-owner-c'];
    const leaguesBefore = await prisma.league.count({ where: { ownerKey: { in: auditOwners } } });
    for (const key of Object.keys(ROUTE_COVERAGE)) {
      if (!routes.has(key)) continue;
      for (const c of ROUTE_COVERAGE[key]) {
        // The ceiling case has to be measured against a caller who is AT the
        // ceiling, and the limit is env-tunable by design (lib/owner.ts), so
        // the audit turns it down for that one request and puts it back.
        const capCase = c.name.includes('per-owner ceiling');
        const before = process.env.MAX_LEAGUES_PER_OWNER;
        if (capCase) process.env.MAX_LEAGUES_PER_OWNER = '1';
        try { await runRouteCase(c); }
        finally { if (capCase) { if (before === undefined) delete process.env.MAX_LEAGUES_PER_OWNER; else process.env.MAX_LEAGUES_PER_OWNER = before; } }
      }
    }

    // What the create route actually wrote, read back off the row. A clamped
    // settings blob is the claim; the stored JSON is the evidence.
    const madeByRoute = await prisma.league.findMany({
      where: { ownerKey: 'audit-owner-c' },
      select: { id: true, name: true, settings: true, ownerKey: true },
    });
    for (const l of madeByRoute) created.push(l.id);
    check('create / exactly one league came out of the hostile POST', madeByRoute.length === 1, `${madeByRoute.length} leagues`);
    if (madeByRoute.length === 1) {
      const s = JSON.parse(madeByRoute[0].settings);
      check('create / the name is bounded', madeByRoute[0].name.length <= 60, `${madeByRoute[0].name.length} characters`);
      check('create / seasonLength is the league default, not the caller’s', s.seasonLength === 17, `stored ${JSON.stringify(s.seasonLength)}`);
      check('create / rosterMax is the league default', s.rosterMax === 53, `stored ${JSON.stringify(s.rosterMax)}`);
      check('create / draftRounds is the league default', s.draftRounds === 7, `stored ${JSON.stringify(s.draftRounds)}`);
      check('create / capMode stays a real mode', ['REALISTIC', 'SIMPLIFIED', 'OFF'].includes(s.capMode), `stored ${JSON.stringify(s.capMode)}`);
      check('create / difficulty stays a real difficulty', ['EASY', 'NORMAL', 'HARD'].includes(s.difficulty), `stored ${JSON.stringify(s.difficulty)}`);
      check('create / leagueStart stays a real start', ['RANDOM_ROSTERS', 'FANTASY_DRAFT', 'REBUILD'].includes(s.leagueStart), `stored ${JSON.stringify(s.leagueStart)}`);
      for (const key of ['tradeDeadlineWeek', 'aiTradeFrequency', 'simVariance', 'injurySeverity', 'progressionSpeed']) {
        check(`create / ${key} is a finite number`, Number.isFinite(s[key]), `stored ${JSON.stringify(s[key])}`);
      }
      // An unstamped save is invisible AND undeletable in production, so the
      // stamp is part of the refusal surface, not cosmetics (see lib/owner.ts).
      check('create / the save is stamped with the caller’s owner key', madeByRoute[0].ownerKey === 'audit-owner-c', `stamped ${JSON.stringify(madeByRoute[0].ownerKey)}`);
    }
    const leaguesAfter = await prisma.league.count({ where: { ownerKey: { in: auditOwners } } });
    check('create / only the one intended league was written', leaguesAfter - leaguesBefore === 1, `${leaguesAfter - leaguesBefore} new leagues under this audit\u2019s owner keys`);

    // -------------------------------------------------------------------
    // Canaries
    // -------------------------------------------------------------------
    const leagueRow = await prisma.league.findUniqueOrThrow({ where: { id: a }, select: { name: true, ownerKey: true } });
    console.log('\nCANARIES');
    /**
     * (A) THE FALSE CLAIM, ASSERTED DIRECTLY — not its negation.
     *
     * This used to read `check(..., !canaryA)`, which prints `ok` and proves
     * only that an assertion CAN pass. The header above promises a line that
     * FAILS, and a canary that has never printed FAIL is not one. So the false
     * claim itself is asserted; the expected failure is then consumed, because
     * it is the evidence, not a defect. If it ever prints `ok`, the harness is
     * reading the wrong row and nothing above it means anything.
     */
    const beforeCanary = failures.length;
    check('(A) my save is owned by the stranger \u2014 KNOWINGLY FALSE, this line must read FAIL',
      leagueRow.ownerKey === OWNER_B, `ownerKey=${leagueRow.ownerKey}`);
    const canaryAFailed = failures.length === beforeCanary + 1;
    if (canaryAFailed) failures.pop();
    console.log(`        -> canary (A) ${canaryAFailed ? 'FAILED, as required' : 'PASSED \u2014 THE HARNESS IS BROKEN'}`);
    if (!canaryAFailed) failures.push('canary (A) passed a knowingly false claim');
    const canaryB = (leagueRow as unknown as Record<string, unknown>).ownerKeyy;
    check('(B) misspelled field reads undefined', canaryB === undefined, `read ${JSON.stringify(canaryB)}`);
    check('(C) real read passes: my save is named for this run', leagueRow.name === `${stamp}-a`, `read ${leagueRow.name}`);
  } finally {
    // By collected id, never by name prefix — this database holds real saves.
    for (const id of created) await prisma.league.delete({ where: { id } }).catch(() => {});

    // AND the cost-ceiling counters this run spent. lib/costLimit.ts meters
    // CREATE, EXPORT and the rest per hour, and this audit drives those routes
    // with a FIXED owner key — so without this, a second run inside the same
    // hour is refused 429 where it expects 413 or 400, and reports a hole that
    // is really just its own last run. A gate that cries wolf gets ignored.
    // Scoped to this audit's own buckets so a developer's real hourly budget
    // is left alone.
    // The audit's own account goes too, and with it — by cascade — every
    // share code it published and the session it signed in with. Deleted
    // before the counters so a failure here cannot skip them.
    const accounts = await prisma.user.deleteMany({ where: { id: { in: [auditUser.id, otherUser.id] } } })
      .catch(() => ({ count: 0 }));

    const spent = await prisma.authAttempt.deleteMany({
      where: {
        kind: { in: ['CREATE', 'EXPORT', 'ADVANCE', 'DRAFT_RUN', 'CSV_CONVERT', 'VALIDATE', 'PUBLISH', 'CODE_LOOKUP'] },
        // By PREFIX, not by a list of the two owner keys that were obvious
        // when this was written: the audit also drives routes as
        // `audit-owner-c`, and a list silently stops covering the next one
        // somebody adds. A real player's bucket is `own:k:<uuid>`, so this
        // prefix cannot reach one.
        // Three shapes now, not one. The cookie-owned buckets this audit has
        // always driven; the ACCOUNT bucket, because the publish cases sign
        // in and `ownerScope` files a signed-in caller under `own:u:<id>`;
        // and the anonymous bucket the cookieless redeem cases land in.
        OR: [
          { scope: { startsWith: 'own:k:audit-owner-' } },
          { scope: { in: [`own:u:${auditUser.id}`, `own:u:${otherUser.id}`] } },
          // And the shared anonymous bucket, which is where a cookieless
          // caller's CODE_LOOKUP rows land (see countsAnonymousOwner in
          // lib/costLimit.ts) — the redeem cases below are deliberately
          // cookieless, so without this a second run inside the hour is
          // refused 429 where it expects a 404.
          { scope: 'own:anonymous', kind: 'CODE_LOOKUP' },
        ],
      },
    }).catch(() => ({ count: 0 }));

    console.log(`\nCleaned up ${created.length} scratch leagues by id, ${accounts.count} audit account(s) and their codes, and ${spent.count} cost-counter row(s).`);
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('\nEvery exported action refused. No holes.');
  }
}

main().finally(() => prisma.$disconnect());
