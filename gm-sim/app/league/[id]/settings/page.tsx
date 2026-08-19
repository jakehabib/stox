import { getLeagueContext } from '@/lib/league-data';
import { updateSettingsAction } from '@/app/actions/league';

export default async function SettingsPage({ params }: { params: { id: string } }) {
  const { league, settings } = await getLeagueContext(params.id);
  const action = updateSettingsAction.bind(null, league.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">League Settings</h1>
        <p className="text-muted text-sm mt-1">Full control surface from the design doc. A few toggles marked "stored only" are recorded but not yet wired into a system.</p>
      </div>

      <form action={action} className="space-y-6">
        <Section title="Core Rules">
          <SelectField label="Salary Cap Mode" name="capMode" defaultValue={settings.capMode} options={[['REALISTIC', 'Realistic'], ['SIMPLIFIED', 'Simplified'], ['OFF', 'Off']]} />
          <SelectField label="Difficulty" name="difficulty" defaultValue={settings.difficulty} options={[['ROOKIE', 'Rookie'], ['PRO', 'Pro'], ['ALL_PRO', 'All-Pro'], ['LEGEND', 'Legend']]} />
        </Section>

        <Section title="Scouting / Fog of War">
          <Toggle label="Scouting enabled" name="scoutingEnabled" defaultChecked={settings.scoutingEnabled} />
          <Toggle label="Reveal true ratings everywhere (debug)" name="revealTrueRatings" defaultChecked={settings.revealTrueRatings} />
          <Toggle label="Fog applies to your own roster too" name="fogOnOwnRoster" defaultChecked={settings.fogOnOwnRoster} />
          <NumberField label="Scouting budget / week" name="scoutingBudgetPerWeek" defaultValue={settings.scoutingBudgetPerWeek} />
        </Section>

        <Section title="Progression & Injuries">
          <NumberField label="Progression speed multiplier" name="progressionSpeed" defaultValue={settings.progressionSpeed} step="0.1" />
          <Toggle label="Injuries enabled" name="injuriesEnabled" defaultChecked={settings.injuriesEnabled} />
          <NumberField label="Injury severity multiplier" name="injurySeverity" defaultValue={settings.injurySeverity} step="0.1" />
          <Toggle label="Retirement enabled" name="retirementEnabled" defaultChecked={settings.retirementEnabled} />
        </Section>

        <Section title="Transactions">
          <Toggle label="Trades enabled" name="tradesEnabled" defaultChecked={settings.tradesEnabled} />
          <NumberField label="AI trade frequency (0-1)" name="aiTradeFrequency" defaultValue={settings.aiTradeFrequency} step="0.05" />
          <Toggle label="Franchise tag enabled" name="franchiseTagEnabled" defaultChecked={settings.franchiseTagEnabled} />
          <Toggle label="AI accepts lopsided trades (easy mode)" name="aiAcceptsLopsided" defaultChecked={settings.aiAcceptsLopsided} />
        </Section>

        <Section title="Simulation">
          <NumberField label="Sim variance multiplier" name="simVariance" defaultValue={settings.simVariance} step="0.1" />
          <Toggle label="Home field advantage" name="homeFieldAdvantage" defaultChecked={settings.homeFieldAdvantage} />
        </Section>

        <Section title="Presentation">
          <SelectField label="Recap verbosity" name="recapVerbosity" defaultValue={settings.recapVerbosity} options={[['SHORT', 'Short'], ['NORMAL', 'Normal'], ['DETAILED', 'Detailed']]} />
          <Toggle label="Show advanced stats (stored only)" name="showAdvancedStats" defaultChecked={settings.showAdvancedStats} />
          <Toggle label="Auto-advance weeks (stored only)" name="autoAdvanceWeeks" defaultChecked={settings.autoAdvanceWeeks} />
          <Toggle label="Confirm risky moves" name="confirmRiskyMoves" defaultChecked={settings.confirmRiskyMoves} />
        </Section>

        <button type="submit" className="btn-primary">Save Settings</button>
      </form>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card card-pad space-y-3">
      <h2 className="font-semibold text-sm">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Toggle({ label, name, defaultChecked }: { label: string; name: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-center justify-between text-sm cursor-pointer">
      <span>{label}</span>
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="w-4 h-4 accent-accent" />
    </label>
  );
}

function NumberField({ label, name, defaultValue, step = '1' }: { label: string; name: string; defaultValue: number; step?: string }) {
  return (
    <label className="flex items-center justify-between text-sm gap-4">
      <span>{label}</span>
      <input type="number" step={step} name={name} defaultValue={defaultValue} className="input w-32 text-right" />
    </label>
  );
}

function SelectField({ label, name, defaultValue, options }: { label: string; name: string; defaultValue: string; options: [string, string][] }) {
  return (
    <label className="flex items-center justify-between text-sm gap-4">
      <span>{label}</span>
      <select name={name} defaultValue={defaultValue} className="input w-48">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
