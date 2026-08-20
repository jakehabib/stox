interface Asset { label: string; sub?: string }

export function TradeOfferPreview({
  sendTeam, receiveTeam, send, receive, capImpact, interest,
}: {
  sendTeam: string; receiveTeam: string; send: Asset[]; receive: Asset[];
  capImpact: string; interest: { label: string; color: string };
}) {
  return (
    <div className="panel px-5 py-4">
      <div className="grid grid-cols-2 gap-6">
        <TradeSide title={`You Send (${sendTeam})`} assets={send} />
        <TradeSide title={`You Receive (${receiveTeam})`} assets={receive} accent />
      </div>
      <div className="divider mt-4 pt-3 flex items-center justify-between text-sm">
        <span className="text-muted">Cap impact: <span className="text-chalk font-medium">{capImpact}</span></span>
        <span className={`font-semibold ${interest.color}`}>{interest.label}</span>
      </div>
    </div>
  );
}

function TradeSide({ title, assets, accent }: { title: string; assets: Asset[]; accent?: boolean }) {
  return (
    <div>
      <div className="label-sm mb-2">{title}</div>
      <div className="space-y-1.5">
        {assets.map((a) => (
          <div key={a.label} className={`text-sm font-medium ${accent ? 'text-accent' : 'text-chalk'}`}>
            {a.label}
            {a.sub && <span className="text-muted font-normal text-xs ml-1.5">{a.sub}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
