type Tone = "bullish" | "bearish" | "neutral" | "info";

const toneClasses: Record<Tone, string> = {
  bullish: "text-gain border-gain/40",
  bearish: "text-loss border-loss/40",
  neutral: "text-yellow-400 border-yellow-400/40",
  info: "text-gray-300 border-border",
};

export default function SignalCard({
  label,
  value,
  tone = "info",
}: {
  label: string;
  value: string | number;
  tone?: Tone;
}) {
  return (
    <div className={`border rounded-md p-4 bg-panel ${toneClasses[tone]}`}>
      <div className="text-xs uppercase tracking-wide text-gray-400">
        {label}
      </div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}
