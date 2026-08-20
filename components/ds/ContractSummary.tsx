import { StatNumber } from './StatNumber';

export function ContractSummary({ apy, yearsRemaining, capHit, futureCapHit }: {
  apy: string; yearsRemaining: number; capHit: string; futureCapHit?: string;
}) {
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-3">
      <StatNumber value={apy} label="APY" size="sm" />
      <StatNumber value={`${yearsRemaining} yr${yearsRemaining === 1 ? '' : 's'}`} label="Remaining" size="sm" />
      <StatNumber value={capHit} label="This Year's Cap Hit" size="sm" color="text-accent2" />
      {futureCapHit && <StatNumber value={futureCapHit} label="Next Year's Cap Hit" size="sm" color="text-muted" />}
    </div>
  );
}
