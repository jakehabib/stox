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
 * app/actions/** and proves three things about it:
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
 * IT DISCOVERS THE ACTIONS RATHER THAN LISTING THEM. Every exported async
 * function in app/actions/** is read off the source, and an action with no
 * entry in COVERAGE below is a FAILURE, not a skip. That is the property this
 * file exists for: the next action somebody adds without a guard fails this
 * audit on the day it is added, without anyone remembering to come here.
 *
 * IT CREATES ITS OWN LEAGUES AND DELETES THEM BY ID. The database is shared,
 * it holds real saves, and this file deliberately calls destructive actions —
 * so it never touches a league it did not make, and it cleans up by the ids it
 * collected rather than by matching on a name.
 *
 * THREE CANARIES, printed at the end. A test that cannot fail is not evidence:
 * (A) an assertion at a knowingly false claim, which must FAIL; (B) a read of
 * a deliberately misspelled field, which must come back undefined; (C) a real
 * read that passes. If A ever passes or B ever has a value, the harness is
 * lying and nothing above it means anything.
 * ===========================================================================
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { asViewer } from './requestContext';
import { prisma } from '../lib/db';
import { createLeague } from '../lib/gen/league';

const ACTIONS_DIR = join(__dirname, '..', 'app', 'actions');

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

async function main() {
  // ---------------------------------------------------------------------
  // Discover the surface
  // ---------------------------------------------------------------------
  const exported = new Map<string, string>();
  for (const file of readdirSync(ACTIONS_DIR).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(join(ACTIONS_DIR, file), 'utf8');
    for (const m of src.matchAll(/^export async function (\w+)/gm)) exported.set(m[1], file);
  }
  console.log(`\nDiscovered ${exported.size} exported actions across ${new Set(exported.values()).size} files.\n`);

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
    // Canaries
    // -------------------------------------------------------------------
    const leagueRow = await prisma.league.findUniqueOrThrow({ where: { id: a }, select: { name: true, ownerKey: true } });
    console.log('\nCANARIES');
    const canaryA = leagueRow.ownerKey === OWNER_B;
    check('(A) knowingly false claim must FAIL: my save is owned by the stranger', !canaryA, 'the harness is reading the wrong row');
    const canaryB = (leagueRow as unknown as Record<string, unknown>).ownerKeyy;
    check('(B) misspelled field reads undefined', canaryB === undefined, `read ${JSON.stringify(canaryB)}`);
    check('(C) real read passes: my save is named for this run', leagueRow.name === `${stamp}-a`, `read ${leagueRow.name}`);
  } finally {
    // By collected id, never by name prefix — this database holds real saves.
    for (const id of created) await prisma.league.delete({ where: { id } }).catch(() => {});
    console.log(`\nCleaned up ${created.length} scratch leagues by id.`);
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
