import Link from 'next/link';
import { getLeagueContext } from '@/lib/league-data';
import { updateSettingsAction } from '@/app/actions/league';
import { Tooltip } from '@/components/Tooltip';
import { leagueFileName } from '@/lib/leagueFile';

export default async function SettingsPage({ params }: { params: { id: string } }) {
  const { league, settings } = await getLeagueContext(params.id);
  const action = updateSettingsAction.bind(null, league.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-display font-extrabold text-3xl uppercase tracking-wide">League Settings</h1>
        <p className="text-muted text-sm mt-1">How this league plays. Changes take effect from your next advance — nothing already on the books is rewritten.</p>
      </div>

      <form action={action} className="space-y-6">
        <Section title="Core Rules">
          <SelectField
            label="Salary Cap Mode" name="capMode" defaultValue={settings.capMode}
            options={[['REALISTIC', 'Realistic'], ['SIMPLIFIED', 'Simplified'], ['OFF', 'Off']]}
            tip="Realistic: cap hit is base salary plus prorated signing bonus, and cutting a player leaves dead money behind. Simplified: a flat cap hit every year with no proration or dead money — cuts are free. Off: cap checks are skipped entirely, sign whoever you want."
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
            label="Scouting focus / week (base)" name="scoutingBudgetPerWeek" defaultValue={settings.scoutingBudgetPerWeek}
            tip="Base focus your front office generates per period, before your scouts' speed scales it. Focus is a finite allowance, not a running total: it refills every week (and pays one large lump for the pre-draft window), and only half of a period's grant can be carried over. Raise this to make scouting cheap, lower it to force harder triage. See the Scouting Department page for the live budget and price list."
          />
        </Section>

        <Section title="Progression & Injuries">
          <NumberField
            label="Progression speed multiplier" name="progressionSpeed" defaultValue={settings.progressionSpeed} step="0.1"
            tip="Scales every player's growth and decline roll, applied at development checkpoints roughly every 4 weeks through the season. 1.0 is the tuned default; higher makes careers arc faster."
          />
          <Toggle
            label="Injuries enabled" name="injuriesEnabled" defaultChecked={settings.injuriesEnabled}
            tip="Whether players can get hurt during simulated games at all. Off means every game is played at full health."
          />
          <NumberField
            label="Injury severity multiplier" name="injurySeverity" defaultValue={settings.injurySeverity} step="0.1"
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
            label="AI trade frequency (0-1)" name="aiTradeFrequency" defaultValue={settings.aiTradeFrequency} step="0.05"
            tip="Rough odds, each week, that an AI team proactively sends you an unsolicited trade offer. 0 means AI teams never approach you first — you can still trade with them, you just have to initiate."
          />
          <Toggle
            label="Trade deadline enabled" name="tradeDeadlineEnabled" defaultChecked={settings.tradeDeadlineEnabled}
            tip="When on, no trades (yours or the AI's) go through past the deadline week until free agency opens for the new league year — same shape as the real NFL's deadline and offseason trading freeze."
          />
          <NumberField
            label="Trade deadline (week)" name="tradeDeadlineWeek" defaultValue={settings.tradeDeadlineWeek}
            tip="Last regular-season week trades are allowed. Defaults to 9, matching the real NFL's Tuesday-after-week-9 deadline for a 17-game season."
          />
          <Toggle
            label="Franchise tag enabled" name="franchiseTagEnabled" defaultChecked={settings.franchiseTagEnabled}
            tip="Whether the franchise tag tool is available for handling your own expiring contracts."
          />
          <Toggle
            label="AI accepts lopsided trades (easy mode)" name="aiAcceptsLopsided" defaultChecked={settings.aiAcceptsLopsided}
            tip="Loosens how much value the AI demands to accept a trade — offers that would normally get rejected as lopsided in your favor go through more easily. An easy-mode toggle, not a balance fix."
          />
        </Section>

        <Section title="Simulation">
          <NumberField
            label="Sim variance multiplier" name="simVariance" defaultValue={settings.simVariance} step="0.1"
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

        <button type="submit" className="btn-primary">Save Settings</button>
      </form>

      {/* Sharing. Outside the settings <form> on purpose — it is a download and
          an outbound link, not a setting, and nesting it would make Save
          responsible for it. See docs/custom-leagues.md. */}
      <div className="panel p-4 space-y-3">
        <h2 className="label-sm">Share This League</h2>
        <p className="text-sm text-muted">
          Export the 32 franchises and every player on them as a single league file. Send it to anyone and they
          can import it and play the same league — same teams, same names, same rosters. It is a starting point,
          not a save game: the file carries teams, players and contracts, not your schedule, standings, scouting
          book or league history.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a href={`/api/league/export/${league.id}`} download className="btn-secondary">
            Export League File ↓
          </a>
          <span className="text-xs text-muted">{leagueFileName(league.name)}</span>
          <Link href="/import" className="btn-ghost text-sm">Import a league file →</Link>
        </div>
      </div>
    </div>
  );
}

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

function NumberField({ label, name, defaultValue, step = '1', tip }: { label: string; name: string; defaultValue: number; step?: string; tip?: string }) {
  return (
    <label className="flex items-center justify-between text-sm gap-4">
      <span className="inline-flex items-center gap-1.5">{label}{tip && <Tooltip text={tip} />}</span>
      <input type="number" step={step} name={name} defaultValue={defaultValue} className="input w-32 text-right" />
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
