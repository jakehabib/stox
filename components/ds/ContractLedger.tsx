import {
  capHit, capHitSchedule, deadMoneyOnCut, formatMoney, guaranteedMoney, proration, prorationYears,
  remainingValue, strandedVoidBonus,
  type ContractLike,
} from '@/lib/cap';
import { readJson } from '@/lib/json';
import { CapMode } from '@/lib/types';
import { StatNumber } from './StatNumber';
import { Tooltip } from '../Tooltip';
import { tip } from '@/lib/glossary';

/**
 * WHAT THIS CONTRACT COSTS, EVERY YEAR OF IT, AND WHAT LEAVING IT COSTS.
 *
 * The Contract box on a player's page showed one figure — this year's cap hit
 * — plus a progress bar and two footnote-sized totals. The app owner asked for
 * the rest of it: *"Contract box on player card should show cap hits for the
 * rest of the contract"*, and *"Everything in that box should be more visible
 * 'negotiate extension' for example is so small"*.
 *
 * THE DEAD-MONEY COLUMN IS THE POINT. Year, base, prorated bonus and cap hit
 * are a table; what turns a table into a decision is the last column, which
 * answers the only question a GM actually asks of an existing contract: what
 * does it cost me to get out of this, and when does it get cheap? That figure
 * is `deadMoneyOnCut` evaluated as if the deal had already run to that year —
 * not a formula rewritten here. Nothing in this file re-implements proration,
 * dead money or a cap hit; every number comes out of lib/cap.ts, which is what
 * the sim itself charges. A ledger that computed its own version of the rules
 * would eventually disagree with the cap sheet, and that is the lying-metric
 * bug class (README, design principle 6).
 *
 * BONUS PRORATION STOPS AT FIVE YEARS. That is the real rule
 * (CAP.MAX_PRORATION_YEARS) and it matters enormously now that a deal can run
 * to twelve: years 6-12 of a long contract carry NO prorated bonus at all,
 * they are pure base salary, and the dead money falls to nothing well before
 * the deal ends. The table shows that happening rather than asserting it.
 *
 * Server component on purpose — it is arithmetic over data the page already
 * has, with nothing to interact with, so it costs the client bundle nothing.
 */
export function ContractLedger({ contract, capMode, seasonYear, className }: {
  /** The contract as stored. `baseSalaries` is the full original schedule, indexed from signing. */
  contract: ContractLike & { guaranteed: number; voidYears?: number; isFranchiseTag?: boolean };
  capMode: CapMode;
  /**
   * THE LEAGUE YEAR THE CONTRACT LEDGER IS CURRENTLY WRITTEN IN — row labels
   * only, and it is NOT `League.seasonYear`.
   *
   * Every figure in this table comes out of `capHitSchedule`, whose first entry
   * is the charge for the year the LEDGER is in. `ageContractsForYear` steps
   * that ledger the instant the season ends while `League.seasonYear` waits for
   * RESET_STANDINGS, so through OFFSEASON weeks 1-2 the two are a year apart
   * and a caller handing over the clock labels next year's cap hit with this
   * year's heading — and dates every dead-money figure under it a year early.
   * The answer is `capChargeYear({ phase, week, seasonYear })` (lib/cap.ts),
   * which is the same boundary `teamCapSummary` reports as `capYear` and the
   * Cap page's outlook labels its columns with.
   *
   * Optional, and the fallback carries the identical hazard: `signedYear` is
   * stamped with the clock by every write path, so a deal signed or
   * restructured inside that window backdates its own rows by a year too.
   * Pass the ledger year — a page always has the phase and week to compute it.
   */
  seasonYear?: number;
  className?: string;
}) {
  const thisYear = seasonYear ?? contract.signedYear + Math.max(0, contract.years - contract.yearsRemaining);
  // Nothing to show, and saying "$0.00" eleven times would be worse than
  // saying nothing: in this mode there is no cap, so a contract has no cap
  // consequences to lay out. State that, and state what the deal still is.
  if (capMode === 'OFF') {
    return (
      <div className={className}>
        <StatNumber
          value={`${contract.yearsRemaining} yr${contract.yearsRemaining === 1 ? '' : 's'}`}
          label="Remaining on his deal"
          size="lg"
        />
        <p className="text-sm text-muted mt-2">
          The salary cap is off in this league, so this contract has no cap hits, no dead money and no
          consequences for releasing him. There are no figures to show.
        </p>
      </div>
    );
  }

  const realistic = capMode === 'REALISTIC';
  const bases = readJson<number[]>(contract.baseSalaries, []);
  const elapsed = Math.max(0, contract.years - contract.yearsRemaining);
  const schedule = capHitSchedule(contract, capMode);
  const bonusPerYear = realistic ? proration(contract) : 0;
  // The bonus is charged for five seasons from signing and no more (the real
  // rule). On a long deal the last years are pure base salary, which is also
  // why the dead-money column collapses to nothing before the deal ends — the
  // single most important thing this table has to show about a 12-year
  // contract, since an inescapable one is the whole risk of the mechanic.
  const bonusWindow = prorationYears(contract);
  const voidYears = contract.voidYears ?? 0;

  const rows = schedule.map((hit, i) => ({
    year: thisYear + i,
    /** SIMPLIFIED charges a flat APY and knows nothing about base vs bonus. */
    base: realistic ? (bases[elapsed + i] ?? 0) : null,
    bonus: realistic && elapsed + i < bonusWindow ? bonusPerYear : realistic ? 0 : null,
    hit,
    // What releasing him in THAT season would leave behind: the same function
    // the cut button charges, asked about a contract that has aged into it.
    dead: deadMoneyOnCut({ ...contract, yearsRemaining: contract.yearsRemaining - i }, capMode),
    now: i === 0,
  }));

  // Void years are not seasons. They carry no salary, he is not on the roster
  // for them, and their whole remaining proration accelerates the moment the
  // real deal ends. Drawn as its own line under the table for exactly that
  // reason — as a chip beside "Yr1…Yr4" it read as a fifth contract year,
  // which is the misreading that costs somebody a cap sheet.
  //
  // OFF THE SHARED FUNCTION, not spelled out here. This was
  // `proration x (window - years)`, which is the same figure as
  // `strandedVoidBonus`'s `bonus - proration x years` only up to the dollar
  // `proration` rounds away — a different spelling of one rule, in a fifth
  // file. The line this draws is the line `releaseUnresignedExpiringContracts`
  // will actually write and the dead-money runway already itemises a year
  // early, so all three have to be the same statement.
  const voidDeadMoney = realistic ? strandedVoidBonus(contract) : 0;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <StatNumber value={formatMoney(capHit(contract, capMode))} label={`Cap hit ${thisYear}`} size="lg" tip={tip('capHit')} />
        <StatNumber
          value={`${contract.yearsRemaining} of ${contract.years}`}
          label="Years remaining"
          size="md"
          color="text-chalk"
        />
      </div>

      <div className="flex gap-1 mt-3">
        {Array.from({ length: contract.years }, (_, i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full ${i < elapsed ? 'bg-line' : 'bg-accent'}`} />
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4 pt-4 border-t border-line/60">
        <StatNumber value={formatMoney(remainingValue(contract, capMode))} label="Remaining value" size="sm" />
        <StatNumber value={formatMoney(guaranteedMoney(contract))} label="Guaranteed" size="sm" tip={tip('guaranteedMoney')} />
        <StatNumber
          value={formatMoney(deadMoneyOnCut(contract, capMode))}
          label="Dead if cut today"
          size="sm"
          tip={tip('deadMoney')}
          color={deadMoneyOnCut(contract, capMode) > 0 ? 'text-bad' : 'text-chalk'}
        />
      </div>

      <div className="mt-5">
        {/* The Bonus and Dead-if-cut columns are the two nobody can decode, and
            both explanations belong HERE rather than in the header row: that
            row is inside an `overflow-x-auto` scroller whose height is the
            table's own, so on a one-year deal a bubble has room neither above
            it nor below. Outside the scroller, nothing clips them. */}
        <div className="label-sm mb-2 inline-flex items-center gap-2">
          Cap hit, every year left
          <span className="inline-flex items-center gap-1 normal-case tracking-normal">
            Bonus<Tooltip text={tip('proration')} />
          </span>
          <span className="inline-flex items-center gap-1 normal-case tracking-normal">
            Dead if cut<Tooltip text={tip('deadMoney')} />
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="label-sm text-left py-1.5 pr-3 border-b border-line">Year</th>
                {realistic && <th className="label-sm text-right py-1.5 px-3 border-b border-line">Base</th>}
                {realistic && <th className="label-sm text-right py-1.5 px-3 border-b border-line">Bonus</th>}
                <th className="label-sm text-right py-1.5 px-3 border-b border-line">Cap hit</th>
                <th className="label-sm text-right py-1.5 pl-3 border-b border-line">Dead if cut</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.year} className={r.now ? 'bg-accent/5' : undefined}>
                  <td className="py-2 pr-3 border-b border-line/50">
                    <span className="stat-value text-stat-sm">{r.year}</span>
                    {r.now && <span className="label-sm ml-2 text-accent">now</span>}
                  </td>
                  {realistic && (
                    <td className="py-2 px-3 text-right font-mono tabular-nums border-b border-line/50">
                      {formatMoney(r.base ?? 0)}
                    </td>
                  )}
                  {/* The empty-year dash sits at full `muted`, same as the
                      dead-money column beside it. The two carried muted/50
                      and muted/60 — 2.41:1 and 2.92:1 — so one table drew the
                      same "nothing here" mark in two weights, neither of them
                      readable. */}
                  {realistic && (
                    <td className="py-2 px-3 text-right font-mono tabular-nums border-b border-line/50 text-muted">
                      {r.bonus ? formatMoney(r.bonus) : '—'}
                    </td>
                  )}
                  <td className="py-2 px-3 text-right border-b border-line/50">
                    <span className="stat-value text-stat-sm">{formatMoney(r.hit)}</span>
                  </td>
                  <td className={`py-2 pl-3 text-right font-mono tabular-nums border-b border-line/50 ${r.dead > 0 ? 'text-bad' : 'text-muted'}`}>
                    {r.dead > 0 ? formatMoney(r.dead) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {voidYears > 0 && (
          <div className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2.5 flex flex-wrap items-baseline justify-between gap-3">
            <div className="text-sm text-warn">
              <span className="font-semibold inline-flex items-center gap-1.5">
                +{voidYears} void year{voidYears === 1 ? '' : 's'}
                <Tooltip text={tip('voidYears')} />
              </span>{' '}
              — not seasons he plays, and not years he is paid for.{' '}
              {!realistic
                ? 'With the simplified cap there is no bonus proration for them to stretch, so they do nothing at all here.'
                : voidDeadMoney > 0
                  ? `Whatever bonus is still prorated across them lands as dead money the moment this deal ends, in ${thisYear + contract.yearsRemaining}.`
                  : 'The bonus finished prorating inside the real years of this deal, so they carry nothing — there is no charge waiting at the end.'}
            </div>
            {voidDeadMoney > 0 && (
              <StatNumber value={formatMoney(voidDeadMoney)} label="Lands after the deal" size="sm" color="text-warn" />
            )}
          </div>
        )}

        {!realistic && (
          <p className="text-xs text-muted mt-2">
            Simplified cap: every year of a deal charges the same average figure, there is no bonus
            proration, and releasing him leaves nothing behind.
          </p>
        )}
      </div>
    </div>
  );
}
