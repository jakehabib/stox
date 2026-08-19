'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { evaluateTradeAction, executeTradeAction } from '@/app/actions/trade';
import { ratingColor } from '@/lib/ratings';
import { PlayerAvatar } from './PlayerAvatar';
import { TeamLogo } from './TeamLogo';

interface RosterP { id: string; name: string; position: string; ovr: number; age: number }
interface Pick { id: string; year: number; round: number; slot: number }
interface Team { id: string; name: string; abbr: string }

export function TradeBuilder({
  leagueId, myTeam, partners, partnerId, myRoster, myPicks, partnerRoster, partnerPicks,
}: {
  leagueId: string; myTeam: Team; partners: Team[]; partnerId: string;
  myRoster: RosterP[]; myPicks: Pick[]; partnerRoster: RosterP[]; partnerPicks: Pick[];
}) {
  const router = useRouter();
  const [give, setGive] = useState<Set<string>>(new Set());
  const [get, setGet] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ accepted: boolean; message: string; ratio: number } | null>(null);

  const toggle = (set: Set<string>, setFn: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setFn(next);
    setResult(null);
  };

  const giveAssets = useMemo(() => assetList(give, myRoster, myPicks), [give, myRoster, myPicks]);
  const getAssets = useMemo(() => assetList(get, partnerRoster, partnerPicks), [get, partnerRoster, partnerPicks]);

  const propose = () => {
    startTransition(async () => {
      const evaluation = await evaluateTradeAction(leagueId, partnerId, giveAssets, getAssets);
      setResult({
        accepted: evaluation.accepted,
        ratio: evaluation.ratio,
        message: evaluation.accepted
          ? 'Deal accepted! Click confirm to execute the trade.'
          : evaluation.counter?.message ?? 'Rejected.',
      });
    });
  };

  const execute = () => {
    startTransition(async () => {
      await executeTradeAction(leagueId, myTeam.id, partnerId, giveAssets, getAssets);
      setGive(new Set()); setGet(new Set()); setResult(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="label-sm">Trading with</span>
        <select
          className="input"
          value={partnerId}
          onChange={(e) => { window.location.href = `?with=${e.target.value}`; }}
        >
          {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <TeamPanel title="You send" teamId={myTeam.id} teamAbbr={myTeam.abbr} teamName={myTeam.name} roster={myRoster} picks={myPicks} selected={give} onToggle={(id) => toggle(give, setGive, id)} />
        <TeamPanel title="You receive" teamId={partnerId} teamAbbr={partners.find((p) => p.id === partnerId)?.abbr ?? ''} teamName={partners.find((p) => p.id === partnerId)?.name ?? ''} roster={partnerRoster} picks={partnerPicks} selected={get} onToggle={(id) => toggle(get, setGet, id)} />
      </div>

      <div className="card card-pad flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-muted">{giveAssets.length} asset(s) out · {getAssets.length} asset(s) in</div>
        <div className="flex gap-2">
          <button className="btn-secondary" disabled={pending || (giveAssets.length === 0 && getAssets.length === 0)} onClick={propose}>
            {pending ? 'Evaluating…' : 'Propose Trade'}
          </button>
          {result?.accepted && (
            <button className="btn-primary" disabled={pending} onClick={execute}>Confirm & Execute</button>
          )}
        </div>
      </div>

      {result && (
        <div className={`card card-pad text-sm ${result.accepted ? 'border-accent/40 text-accent' : 'border-bad/30 text-bad'}`}>
          {result.message}
        </div>
      )}
    </div>
  );
}

function assetList(selected: Set<string>, roster: RosterP[], picks: Pick[]) {
  const out: { type: 'PLAYER' | 'PICK'; id: string }[] = [];
  for (const id of selected) {
    if (roster.find((r) => r.id === id)) out.push({ type: 'PLAYER', id });
    else if (picks.find((p) => p.id === id)) out.push({ type: 'PICK', id });
  }
  return out;
}

function TeamPanel({ title, teamId, teamAbbr, teamName, roster, picks, selected, onToggle }: {
  title: string; teamId: string; teamAbbr: string; teamName: string; roster: RosterP[]; picks: Pick[]; selected: Set<string>; onToggle: (id: string) => void;
}) {
  return (
    <div className="card card-pad">
      <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
        <TeamLogo seed={teamId} abbr={teamAbbr} size={24} />
        {title} <span className="text-muted font-normal">({teamName})</span>
      </h3>
      <div className="label-sm mb-1.5">Draft Picks</div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {picks.map((p) => (
          <button
            key={p.id}
            onClick={() => onToggle(p.id)}
            className={`pill ${selected.has(p.id) ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-chalk'}`}
          >
            {p.year} R{p.round}
          </button>
        ))}
        {picks.length === 0 && <span className="text-xs text-muted">No picks owned.</span>}
      </div>
      <div className="label-sm mb-1.5">Roster</div>
      <div className="max-h-64 overflow-y-auto space-y-1">
        {roster.map((p) => (
          <button
            key={p.id}
            onClick={() => onToggle(p.id)}
            className={`flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg text-sm ${selected.has(p.id) ? 'bg-accent/10 border border-accent/30' : 'hover:bg-raised border border-transparent'}`}
          >
            <PlayerAvatar seed={p.id} age={p.age} size={22} />
            <span className="text-xs font-mono text-muted w-8">{p.position}</span>
            <span className={`text-xs font-mono font-semibold w-8 ${ratingColor(p.ovr)}`}>{p.ovr}</span>
            <span className="flex-1 truncate">{p.name}</span>
            <span className="text-xs text-muted">{p.age}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
