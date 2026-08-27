'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { restructureContractAction } from '@/app/actions/roster';
import { formatMoney, capHit, capHitSchedule, convertibleBase, deadMoneyOnCut, proration, prorationYears, restructureContract as computeRestructure, usableVoidYears } from '@/lib/cap';
import { CAP } from '@/lib/tuning';

/**
 * The most void years this control will ever offer to ADD. The real ceiling is
 * always CAP.MAX_PRORATION_YEARS minus the years the deal still has to run;
 * this is just the top of the slider before that clamp bites.
 */
const MAX_ADD_VOID_YEARS = 3;

interface ContractShape {
  years: number; yearsRemaining: number; signedYear: number;
  baseSalaries: string; signingBonus: number; guaranteed: number; voidYears: number;
}

/**
 * Convert part of THIS year's base salary into signing bonus for immediate
 * cap relief — the classic real-NFL restructure. Shows the trade-off
 * explicitly: lower this-year hit, higher future hits, more dead money if
 * cut later, since that's exactly the tension that makes it a real decision.
 */
export function RestructureForm({ leagueId, playerId, contract, capSpace, onDone }: {
  leagueId: string; playerId: string; contract: ContractShape; capSpace: number; onDone?: () => void;
}) {
  const bases: number[] = JSON.parse(contract.baseSalaries);
  const yearIdx = Math.max(0, contract.years - contract.yearsRemaining);
  const currentBase = bases[yearIdx] ?? 0;
  /*
   * THE CEILING ON THE SLIDER IS THE CEILING THE SERVER ENFORCES, and it is
   * read out of the one function that owns it.
   *
   * This was `currentBase - 1_000_000` — the league minimum written out as a
   * literal, in a fourth place. `restructureContract` (lib/cap.ts) clamps
   * every request at `convertibleBase`, whose whole job is to be that one
   * answer, and its own comment says why: "three readings of one floor is
   * three chances to disagree about what a man may be left on." The literal
   * happens to equal CAP.MIN_SALARY today, so nothing was visibly wrong — it
   * is a lying metric with the fuse still in it. Move the minimum and this
   * slider would have offered a GM dollars the server silently refused to
   * convert, and priced the whole panel off them.
   */
  const maxConvert = convertibleBase(contract);

  const [convert, setConvert] = useState(Math.round(maxConvert / 2 / 100_000) * 100_000);
  const [addVoidYears, setAddVoidYears] = useState(0);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  // The current season, derived from the deal itself: yearsRemaining ticks
  // down one per league year, so signedYear + years-elapsed IS this year.
  // (The component deliberately takes no seasonYear prop — every call site
  // already passes `contract` and nothing else needs changing.)
  const nowYear = contract.signedYear + yearIdx;

  /*
   * The number the PREVIEW uses and the number the ACTION is handed have to be
   * the same one. The slider is clamped to its room below; clamping here too
   * means a stale state value (drag to +3 on a short deal, then the deal
   * changes under you) can never send the server something the panel did not
   * price.
   */
  const voidRoom = Math.max(
    0,
    usableVoidYears(contract.yearsRemaining, MAX_ADD_VOID_YEARS)
      - usableVoidYears(contract.yearsRemaining, contract.voidYears ?? 0),
  );
  const submittedVoidYears = Math.min(addVoidYears, voidRoom);

  const preview = useMemo(() => {
    const next = computeRestructure(contract, convert, { addVoidYears: submittedVoidYears, nowYear });
    const nextShaped = { ...next, baseSalaries: JSON.stringify(next.baseSalaries) };
    /*
     * ONE FUNCTION, SO THE PANEL CAN'T DISAGREE WITH ITSELF.
     *
     * This used to add the year's base salary to proration(contract) by hand,
     * which is what capHit does EXCEPT for the `yearIdx < prorationYears`
     * guard — bonus proration stops after five years, and a deal past that
     * window carries none. The year table three inches below already used
     * capHitSchedule, which applies the guard. Measured on an 8-year deal in
     * its 6th year: this row said "$5.19M -> $6.38M" and the table under it
     * said "$6.38M, was $2.60M" for the same season, with "cap space freed
     * up" out by $2.59M. Reachable on any contract past the proration window,
     * which a user builds with two extensions.
     */
    const oldHit = capHit(contract, 'REALISTIC');
    const newHit = capHit(nextShaped, 'REALISTIC');
    // The whole point of the warning below: what the deal looks like in
    // EVERY year left, not just this one. capHitSchedule slices from the
    // year already elapsed, so index 0 is this season for both shapes.
    const oldSchedule = capHitSchedule(contract, 'REALISTIC');
    const newSchedule = capHitSchedule(nextShaped, 'REALISTIC');
    /*
     * WHAT LANDS ON THE VOID YEARS IS PART OF "LATER", AND THIS USED TO LOSE IT.
     *
     * `capHitSchedule` covers the seasons he plays and nothing else, which is
     * right — a void year is not a season. But bonus prorated across void
     * years is charged all the same, in one lump the moment the real deal
     * ends, and adding void years here is precisely how a user pushes money
     * onto them. Counted only through the schedule, the payback line lost
     * every dollar that landed out there. Measured, converting $15.0M of a
     * $20.0M base on a 2-year deal with +2 void years: $11.3M borrowed from
     * this season, $3.75M claimed as the payback, and $7.50M of the bill —
     * two thirds of it — not mentioned at all.
     *
     * With this term the two are one arithmetic identity — what this season
     * frees, the years after it repay, exactly — which is what the sentence
     * under the table has always claimed and can now be held to. Asserted
     * permanently as R-7 in scripts/checkRestructure.ts.
     */
    const onVoidYears = (c: Parameters<typeof proration>[0]) =>
      proration(c) * Math.max(0, prorationYears(c) - c.years);
    const voidLanding = onVoidYears(nextShaped) - onVoidYears(contract);
    return {
      oldHit,
      newHit,
      oldDead: deadMoneyOnCut(contract, 'REALISTIC'),
      newDead: deadMoneyOnCut(nextShaped, 'REALISTIC'),
      capFreed: oldHit - newHit,
      oldSchedule,
      newSchedule,
      /** Extra cap charged in future years to buy this year's relief. */
      futureCost: newSchedule.slice(1).reduce((a, b) => a + b, 0) - oldSchedule.slice(1).reduce((a, b) => a + b, 0)
        + voidLanding,
      /** How much of that payback waits on the void years instead of a season. */
      voidLanding,
      /** The league year the void-year charge arrives in — the deal's last real year plus one. */
      voidLandingYear: nowYear + contract.yearsRemaining,
    };
  }, [convert, submittedVoidYears]);

  const submit = () => {
    startTransition(async () => {
      const result = await restructureContractAction(leagueId, playerId, convert, submittedVoidYears);
      setMsg({ ok: result.ok, text: result.message });
      if (result.ok) { router.refresh(); onDone?.(); }
    });
  };

  if (maxConvert < 100_000) {
    return <p className="text-sm text-muted">This contract's base salary is already at the minimum — nothing left to convert.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="label-sm">Convert to signing bonus</label>
          <span className="text-xs font-mono">{formatMoney(convert)} of {formatMoney(currentBase)}</span>
        </div>
        <input type="range" min={0} max={maxConvert} step={100000} value={convert} onChange={(e) => setConvert(Number(e.target.value))} className="w-full accent-accent" />
      </div>

      {/*
        * THE SLIDER MAY NOT OFFER A POSITION THE CONTRACT WILL DROP.
        *
        * It ran 0-3 on every deal. A restructure rebases the contract onto the
        * years that are LEFT, and proration stops at CAP.MAX_PRORATION_YEARS —
        * so `restructureContract` clamps through `usableVoidYears` and quietly
        * discards anything past the room. Measured, converting $15M on a $20M
        * base:
        *
        *     2yr left:  +0 $17.50M  +1 $13.33M  +2 $11.25M  +3 $10.00M
        *     3yr left:  +0 $13.33M  +1 $11.25M  +2 $10.00M  +3 $10.00M
        *     4yr left:  +0 $11.25M  +1 $10.00M  +2 $10.00M  +3 $10.00M
        *     5yr left:  +0 $10.00M  +1 $10.00M  +2 $10.00M  +3 $10.00M  <- inert
        *
        * The app owner, on a long deal: *"Adding void years on a restructure
        * doesn't seem to move the cap at all."* He was right, and the numbers
        * were right — the control was lying about what it could do. This is the
        * same fix DealStructureControls already carries for the extension
        * slider, through the same clamp, so the two screens cannot disagree
        * about what a void year is worth.
        *
        * `existingVoid` matters because the action ADDS to what the deal already
        * carries: a 3+2 deal has no room left for a third.
        */}
      {(() => {
        // Same two numbers the preview and the submit are built from, above.
        // Recomputing them here is how a slider ends up offering a position
        // the panel does not price.
        const existingVoid = usableVoidYears(contract.yearsRemaining, contract.voidYears ?? 0);
        const room = voidRoom;
        const shown = submittedVoidYears;
        return (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="label-sm">Add void years</label>
              <span className={`text-xs font-mono ${room === 0 ? 'text-muted' : ''}`}>
                {room === 0 ? `None — ${contract.yearsRemaining}yr left` : shown === 0 ? 'None' : `+${shown}`}
              </span>
            </div>
            {room === 0 ? (
              <p className="text-[11px] text-muted mt-1">
                A signing bonus spreads over {CAP.MAX_PRORATION_YEARS} years at most, and this deal still has{' '}
                {contract.yearsRemaining}{existingVoid > 0 ? ` plus ${existingVoid} void` : ''} to run — there is
                nothing further to spread it over. Void years are a short-deal tool: they buy you room on a contract
                with {CAP.MAX_PRORATION_YEARS - 1} years or fewer left.
              </p>
            ) : (
              <>
                <input type="range" min={0} max={room} step={1} value={shown} onChange={(e) => setAddVoidYears(Number(e.target.value))} className="w-full accent-warn" />
                <p className="text-[11px] text-muted mt-1">More void years spread the new bonus thinner (more relief now), but every bit of it hits as dead money at once when the real deal ends.</p>
              </>
            )}
          </div>
        );
      })()}

      <div className="card-pad !p-3 rounded-lg bg-raised space-y-1.5 text-sm">
        <div className="flex justify-between"><span className="text-muted">This year's cap hit</span><span className="font-mono">{formatMoney(preview.oldHit)} → <span className="text-accent font-semibold">{formatMoney(preview.newHit)}</span></span></div>
        {/* This row used to read "Cap space freed up  -$3.78M" — two
            contradictory statements on one line — because a restructure could
            genuinely COST this year's cap: the rebase carried the whole
            original signing bonus onto the years left and re-prorated money
            that had already been charged, and late in a bonus-heavy deal that
            inflation outran the relief the conversion bought.

            It carries only the UNAMORTISED bonus now, so the arithmetic is
            `converted - converted/yearsLeft` and cannot come out below zero;
            the worst a restructure does is nothing at all, in the last year of
            a deal, where there is no later year to push into. The negative
            wording is kept rather than deleted because the row must never be
            the thing that lies if that ever stops being true — a label that
            reads the sign it is given costs nothing to keep honest. */}
        <div className="flex justify-between"><span className="text-muted">{preview.capFreed >= 0 ? 'Cap space freed up' : 'Cap space this costs you'}</span><span className={`font-mono font-semibold ${preview.capFreed >= 0 ? 'text-accent' : 'text-bad'}`}>{formatMoney(Math.abs(preview.capFreed))}</span></div>
        <div className="flex justify-between pt-1 border-t border-line/60"><span className="text-muted">Your cap space after</span><span className="font-mono font-semibold text-accent">{formatMoney(capSpace + preview.capFreed)}</span></div>
        <div className="flex justify-between"><span className="text-muted">Dead money if cut</span><span className="font-mono">{formatMoney(preview.oldDead)} → <span className="text-bad font-semibold">{formatMoney(preview.newDead)}</span></span></div>
      </div>

      {preview.newSchedule.length > 1 && (
        <div className="panel p-3 space-y-1.5">
          <div className="label-sm">Every year left on the deal</div>
          <div className="flex gap-1.5">
            {preview.newSchedule.map((hit, i) => {
              const was = preview.oldSchedule[i] ?? 0;
              const worse = hit > was;
              return (
                <div key={i} className="flex-1 min-w-0 text-center">
                  <div className="label-sm !text-[10px]">{nowYear + i}</div>
                  <div className={`stat-value text-stat-sm ${worse ? 'text-bad' : 'text-accent'}`}>{formatMoney(hit)}</div>
                  <div className="text-[10px] text-muted font-mono truncate">was {formatMoney(was)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {preview.futureCost > 0 && (
        <p className="text-xs text-warn">
          You are borrowing {formatMoney(preview.capFreed)} from this season and paying back {formatMoney(preview.futureCost)}
          {' '}across the later years of the deal
          {preview.voidLanding > 0
            ? `, ${formatMoney(preview.voidLanding)} of it landing in one go in ${preview.voidLandingYear} when the void years come due`
            : ''}
          . That money does not disappear — it just moves.
        </p>
      )}

      <p className="text-xs text-bad">
        The trap: restructure now and cut him later and you pay for BOTH. His dead money rises from{' '}
        {formatMoney(preview.oldDead)} to {formatMoney(preview.newDead)} — release him after this and{' '}
        {formatMoney(preview.newDead)} lands on your cap for a player who is no longer on the roster.
        Only restructure a player you intend to keep.
      </p>

      <p className="text-xs text-muted">Future years absorb the rest — this only moves WHEN the money hits the cap, not how much you owe overall.</p>

      <button disabled={pending || convert <= 0} onClick={submit} className="btn-primary w-full disabled:opacity-40">
        {pending ? 'Restructuring…' : 'Restructure Contract'}
      </button>
      {msg && <p className={`text-xs ${msg.ok ? 'text-accent' : 'text-accent2'}`}>{msg.text}</p>}
    </div>
  );
}
