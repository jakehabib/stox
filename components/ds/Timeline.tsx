interface Entry { year: string; text: string }

/**
 * A narrative history — year + colored marker + a sentence — reads as a
 * story of the franchise/player, not a database transaction log. Use for
 * "how did we get here" content; keep the plain transaction ledger (dates,
 * amounts) elsewhere for when someone needs the receipts.
 */
export function Timeline({ entries }: { entries: Entry[] }) {
  return (
    <div className="space-y-3">
      {entries.map((e, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center pt-1 shrink-0">
            <span className="w-2 h-2 rounded-full bg-accent2" />
            {i < entries.length - 1 && <span className="w-px flex-1 bg-line mt-1" />}
          </div>
          <div className="pb-1">
            <span className="font-mono text-xs text-muted">{e.year}</span>
            <p className="text-sm mt-0.5">{e.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
