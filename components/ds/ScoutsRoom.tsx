/**
 * The staff's editorial voice — a direct quote from a named advisor, not
 * another bullet list. Small, text-forward, deliberately understated
 * against the louder board/hero around it.
 */
export function ScoutsRoom({ quote, attribution }: { quote: string; attribution: string }) {
  return (
    <div className="panel p-4 border-l-2 border-l-gold">
      <div className="label-sm mb-2 text-gold">Scout's Room</div>
      <p className="text-sm italic text-chalk/90 leading-relaxed">&ldquo;{quote}&rdquo;</p>
      <p className="text-xs text-muted mt-2">— {attribution}</p>
    </div>
  );
}
