import Link from 'next/link';
import { getLeagueContext } from '@/lib/league-data';
import { abandonRebuildAction, updateSettingsAction } from '@/app/actions/league';
import { loadRebuildStanding } from '@/lib/rebuildState';
import { RebuildLock } from '@/components/RebuildLock';
import { REBUILD_LABEL } from '@/lib/rebuild';
import { Tooltip } from '@/components/Tooltip';
import { leagueFileName } from '@/lib/leagueFile';
import { CAP_GROWTH_MODES, formatCapGrowthRate } from '@/lib/settings';
import { SettingsForm } from '@/components/SettingsForm';

export default async function SettingsPage({ params }: { params: { id: string } }) {
  const { league, settings } = await getLeagueContext(params.id);
  const action = updateSettingsAction.bind(null, league.id);

  /**
   * WHAT THIS SCREEN IS ALLOWED TO OFFER, decided by a database read.
   *
   * The same read `updateSettingsAction` runs before it writes, so the screen
   * and the rule cannot disagree — and the rule is the one on the server. If
   * this render is somehow stale, the write is still refused.
   */
  const rebuild = await loadRebuildStanding(league.id);
  const abandon = abandonRebuildAction.bind(null, league.id);

  if (rebuild.ironman) {
    return (
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="font-display font-extrabold text-3xl uppercase tracking-wide">League Settings</h1>
          <p className="text-muted text-sm mt-1">
            {/* REBUILD_LABEL already carries its article ("The Rebuild"), so it
                is dropped in rather than pluralised into "a the rebuild run". */}
            This league is {REBUILD_LABEL}. Its rules were set the day you took the job.
          </p>
        </div>

        {/* THE WHOLE SCREEN IN THIS STATE. Dead controls with no explanation
            read as a broken page; a page that says why reads as a rule. */}
        <div className="panel p-5 space-y-4 border-warn/30">
          <div className="label-sm text-warn">Locked</div>
          <p className="text-sm text-chalk/90 leading-relaxed max-w-2xl">
            You took this job on the understanding that nothing about the league would bend for you. Every club
            plays what its roster is worth, no trade goes through that the other side did not agree to, and the
            ceiling is the same number next year that it is today — so there is no waiting for the money to
            catch up with your mistakes. Win a championship and every one of these settings is yours again.
          </p>
          <ul className="text-sm text-muted space-y-1.5">
            <li>· Difficulty is Normal, and stays Normal.</li>
            <li>· Forced trades are off. The other club always gets a vote.</li>
            <li>· The salary cap does not move from season to season.</li>
            <li>· Nothing else on this screen can be changed either.</li>
          </ul>
          <p className="text-xs text-muted">
            {rebuild.seasonsPlayed === 0
              ? 'Season one is not on the books yet.'
              : `${rebuild.seasonsPlayed} season${rebuild.seasonsPlayed === 1 ? '' : 's'} played so far. The board records the season you win your first title in — nothing after it.`}
          </p>
          <div className="pt-1"><RebuildLock action={abandon} /></div>
        </div>

        <ShareLeague leagueId={league.id} leagueName={league.name} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-display font-extrabold text-3xl uppercase tracking-wide">League Settings</h1>
        <p className="text-muted text-sm mt-1">How this league plays. Changes take effect from your next advance — nothing already on the books is rewritten.</p>
      </div>

      {/* A rebuild run that is over. The screen says which of the two ways it
          ended, because they are not the same thing and only one of them is on
          the board. */}
      {rebuild.state === 'WON' && (
        <div className="panel p-4 border-accent/40">
          <div className="label-sm text-accent">The rebuild is over</div>
          <p className="text-sm text-chalk/90 mt-1.5 max-w-2xl">
            You won it in {rebuild.seasonsToTitle === 1 ? 'your first season' : `season ${rebuild.seasonsToTitle}`}, and
            the league is yours to run however you like from here. The number stands whatever you do next.
          </p>
          <Link href={`/league/${league.id}/rebuild`} className="btn-secondary text-sm mt-3 inline-flex">
            See the whole climb →
          </Link>
        </div>
      )}
      {rebuild.state === 'ABANDONED' && (
        <div className="panel p-4">
          <div className="label-sm">The rebuild was ended</div>
          <p className="text-sm text-muted mt-1.5 max-w-2xl">
            This save is an ordinary league now. It keeps its history and its dynasty level; what it does not keep
            is a claim on the Rebuild board, and there is no route back to those rules.
          </p>
        </div>
      )}

      <SettingsForm action={action}>
        <Section title="Core Rules">
          <SelectField
            label="Salary Cap Mode" name="capMode" defaultValue={settings.capMode}
            options={[['REALISTIC', 'Realistic'], ['SIMPLIFIED', 'Simplified'], ['OFF', 'Off']]}
            tip="Realistic: cap hit is base salary plus prorated signing bonus, and cutting a player leaves dead money behind. Simplified: a flat cap hit every year with no proration or dead money — cuts are free. Off: cap checks are skipped entirely, sign whoever you want."
          />
          <SelectField
            label="Cap Growth" name="capGrowth" defaultValue={settings.capGrowth}
            /* Rungs, labels and percentages all come off CAP_GROWTH_MODES, so
               what this screen says the ceiling does is read from the same
               table capForLeague() computes it with — a rung cannot be renamed,
               retuned or added and leave this control describing the old one. */
            options={CAP_GROWTH_MODES_OPTIONS}
            tip={CAP_GROWTH_TIP}
          />
          <SelectField
            label="Difficulty" name="difficulty" defaultValue={settings.difficulty}
            options={[['EASY', 'Easy'], ['NORMAL', 'Normal'], ['HARD', 'Hard']]}
            tip="Higher difficulty makes AI teams play better (a rating bonus in simulated games) and value players more sharply in trades and free agency, while your own scouting gets noisier — the AI doesn't get smarter about hiding information, it just gets harder to exploit."
          />
        </Section>

        <Section title="Scouting / Fog of War">
          <Toggle
            label="Scouting enabled" name="scoutingEnabled" defaultChecked={settings.scoutingEnabled}
            tip="When off, every player's true ratings are visible immediately, everywhere — no fog of war, no need to scout anyone."
          />
          <Toggle
            label="Reveal true ratings everywhere (debug)" name="revealTrueRatings" defaultChecked={settings.revealTrueRatings}
            tip="Bypasses scouting fog entirely, including on opponents and free agents — meant for testing/debugging, not a normal way to play."
          />
          <Toggle
            label="Fog applies to your own roster too" name="fogOnOwnRoster" defaultChecked={settings.fogOnOwnRoster}
            tip="Normally your own players' true ratings are always visible. Turning this on fogs them too, for a harder, more realistic mode where even your own scouts can be wrong about your guys."
          />
          <NumberField
            label="Scouting focus / week (base)" name="scoutingBudgetPerWeek" defaultValue={settings.scoutingBudgetPerWeek} min={0} max={10000}
            tip="Base focus your front office generates per period, before your scouts' speed scales it. Focus is a finite allowance, not a running total: it refills every week (and pays one large lump for the pre-draft window), and only half of a period's grant can be carried over. Raise this to make scouting cheap, lower it to force harder triage. See the Scouting Department page for the live budget and price list."
          />
        </Section>

        <Section title="Progression & Injuries">
          <NumberField
            label="Progression speed multiplier" name="progressionSpeed" defaultValue={settings.progressionSpeed} step="0.1" min={0} max={5}
            tip="Scales every player's growth and decline roll, applied at development checkpoints roughly every 4 weeks through the season. 1.0 is the tuned default; higher makes careers arc faster."
          />
          <Toggle
            label="Injuries enabled" name="injuriesEnabled" defaultChecked={settings.injuriesEnabled}
            tip="Whether players can get hurt during simulated games at all. Off means every game is played at full health."
          />
          <NumberField
            label="Injury severity multiplier" name="injurySeverity" defaultValue={settings.injurySeverity} step="0.1" min={0} max={5}
            tip="Scales how many weeks an injury keeps a player out. Doesn't change how often injuries happen, only how long they last."
          />
          <Toggle
            label="Retirement enabled" name="retirementEnabled" defaultChecked={settings.retirementEnabled}
            tip="Whether players 32 and older can retire during the offseason. Off means every veteran plays until you cut them, however old they get."
          />
        </Section>

        <Section title="Transactions">
          <Toggle
            label="Trades enabled" name="tradesEnabled" defaultChecked={settings.tradesEnabled}
            tip="Master switch for trading — off disables both your own trade offers and unsolicited AI-to-you offers."
          />
          <NumberField
            label="AI trade frequency (0-1)" name="aiTradeFrequency" defaultValue={settings.aiTradeFrequency} step="0.05" min={0} max={1}
            tip="Rough odds, each week, that an AI team proactively sends you an unsolicited trade offer. 0 means AI teams never approach you first — you can still trade with them, you just have to initiate."
          />
          <Toggle
            label="Trade deadline enabled" name="tradeDeadlineEnabled" defaultChecked={settings.tradeDeadlineEnabled}
            tip="When on, no trades (yours or the AI's) go through past the deadline week until free agency opens for the new league year — same shape as the real NFL's deadline and offseason trading freeze."
          />
          <NumberField
            label="Trade deadline (week)" name="tradeDeadlineWeek" defaultValue={settings.tradeDeadlineWeek} min={1} max={Math.max(1, settings.seasonLength)}
            tip="Last regular-season week trades are allowed. Defaults to 9, matching the real NFL's Tuesday-after-week-9 deadline for a 17-game season."
          />
          <Toggle
            label="Franchise tag enabled" name="franchiseTagEnabled" defaultChecked={settings.franchiseTagEnabled}
            tip="Whether the franchise tag tool is available for handling your own expiring contracts."
          />
          <Toggle
            label="AI accepts lopsided trades (easy mode)" name="aiAcceptsLopsided" defaultChecked={settings.aiAcceptsLopsided}
            tip="Loosens how much value the AI demands to accept a trade — offers that would normally get rejected as lopsided in your favor go through more easily. It moves the bar; it does not remove it, and a deal no club would ever want is still refused. For that, use Allow forced trades below."
          />
          <Toggle
            label="Allow forced trades" name="forceTradeEnabled" defaultChecked={settings.forceTradeEnabled}
            tip="Puts a Force Trade button on the trade screen that writes a deal through whatever it looks like — no agreement from the other club, no salary cap check, no roster limit, no deadline. Every dollar is still booked, so your cap sheet shows exactly where it left you, and the season will not advance while your own club is over the cap. Meant as a repair tool for a save that has got stuck, not a way to play."
          />
        </Section>

        <Section title="Simulation">
          <NumberField
            label="Sim variance multiplier" name="simVariance" defaultValue={settings.simVariance} step="0.1" min={0} max={5}
            tip="How much randomness affects a game's outcome versus the two teams' actual rating gap. Higher means more upsets; lower means the better roster wins more consistently."
          />
          <Toggle
            label="Home field advantage" name="homeFieldAdvantage" defaultChecked={settings.homeFieldAdvantage}
            tip="Whether the home team gets a small rating boost when a game is simulated."
          />
        </Section>

        <Section title="Presentation">
          <SelectField
            label="Recap verbosity" name="recapVerbosity" defaultValue={settings.recapVerbosity}
            options={[['SHORT', 'Short'], ['NORMAL', 'Normal'], ['DETAILED', 'Detailed']]}
            tip="How much detail the auto-generated write-up after each game includes."
          />
        </Section>

      </SettingsForm>

      <ShareLeague leagueId={league.id} leagueName={league.name} />

    </div>
  );
}

/**
 * Export/import, lifted out of the page body so the locked screen and the
 * ordinary one show the same block rather than two copies free to drift. It is
 * not a setting — it is a download and an outbound link — which is why it was
 * outside the settings <form> to begin with. See docs/custom-leagues.md.
 */
function ShareLeague({ leagueId, leagueName }: { leagueId: string; leagueName: string }) {
  return (
    <div className="panel p-4 space-y-3">
      <h2 className="label-sm">Share This League</h2>
      <p className="text-sm text-muted">
        Export the 32 franchises and every player on them as a single league file. Send it to anyone and they
        can import it and play the same league — same teams, same names, same rosters. It is a starting point,
        not a save game: the file carries teams, players and contracts, not your schedule, standings, scouting
        book or league history.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <a href={`/api/league/export/${leagueId}`} download className="btn-secondary">
          Export League File ↓
        </a>
        <span className="text-xs text-muted">{leagueFileName(leagueName)}</span>
        <Link href="/import" className="btn-ghost text-sm">Import a league file →</Link>
      </div>
    </div>
  );
}

/**
 * How fast the ceiling climbs, said the way a cap analyst would say it. Every
 * percentage is formatted from the rung's real rate, never typed out — the
 * number in the sentence is the number the league is played under.
 *
 * One tip carrying all three rungs rather than a hint line under the control:
 * the choice is only meaningful as a comparison, and a player reading "Slow"
 * on its own has no idea what it is slow COMPARED to.
 */
const CAP_GROWTH_MODES_OPTIONS: [string, string][] = Object.entries(CAP_GROWTH_MODES)
  .map(([key, m]) => [key, `${m.label} — ${formatCapGrowthRate(m.rate)} a year`] as [string, string]);

const CAP_GROWTH_TIP = [
  'What the salary cap does between seasons.',
  ...Object.values(CAP_GROWTH_MODES).map((m) => `${m.label} (${formatCapGrowthRate(m.rate)}/yr): ${m.blurb}`),
  'Wages are quoted in today\u2019s money whatever you pick, so the faster the ceiling climbs the less it ever asks of you.',
  'Changing it mid-dynasty moves the ceiling under deals already on the books. Lowering it can leave clubs over the cap the next morning \u2014 including yours, and the season does not advance while you are over it, so clear the difference before you press on.',
].join(' ');

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-4 space-y-3">
      <h2 className="label-sm">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Toggle({ label, name, defaultChecked, tip }: { label: string; name: string; defaultChecked: boolean; tip?: string }) {
  return (
    <label className="flex items-center justify-between text-sm cursor-pointer">
      <span className="inline-flex items-center gap-1.5">{label}{tip && <Tooltip text={tip} />}</span>
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="w-4 h-4 accent-accent" />
    </label>
  );
}

/**
 * A NUMBER BOX THAT OFFERS ONLY WHAT THE SERVER WILL ACCEPT.
 *
 * `updateSettingsAction` clamps every one of these through its own `num()`
 * helper, so a hostile or fat-fingered value can never reach the sim. It could
 * still be TYPED, though, and the box would show it, the form would post it,
 * and the screen would come back rendering a different number from the one the
 * GM just entered with nothing said about it — a control quietly lying about
 * what it did. The bounds below are the same ones that helper clamps to (see
 * app/actions/league.ts), so the stepper stops where the rule stops and the
 * browser refuses out-of-range input before it is sent.
 *
 * The server clamp is still the authority and is not to be removed: a form
 * POST is a POST, and `min`/`max` on an input protect nothing on their own.
 */
function NumberField({ label, name, defaultValue, step = '1', min, max, tip }: { label: string; name: string; defaultValue: number; step?: string; min?: number; max?: number; tip?: string }) {
  return (
    <label className="flex items-center justify-between text-sm gap-4">
      <span className="inline-flex items-center gap-1.5">{label}{tip && <Tooltip text={tip} />}</span>
      <input type="number" step={step} min={min} max={max} name={name} defaultValue={defaultValue} className="input w-32 text-right" />
    </label>
  );
}

function SelectField({ label, name, defaultValue, options, tip }: { label: string; name: string; defaultValue: string; options: [string, string][]; tip?: string }) {
  return (
    <label className="flex items-center justify-between text-sm gap-4">
      <span className="inline-flex items-center gap-1.5">{label}{tip && <Tooltip text={tip} />}</span>
      <select name={name} defaultValue={defaultValue} className="input w-48">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
