"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import SignalCard from "./SignalCard";
import type { ScanFocusArea, ScanResult } from "@/types";

const FOCUS_AREAS: ScanFocusArea[] = [
  "Momentum",
  "Trend Strength",
  "Risk/Reward",
  "Earnings Catalyst",
  "Short Squeeze",
  "Breakout Setup",
];

function signalTone(signal: ScanResult["analysis"]["overallSignal"]) {
  if (signal === "BULLISH") return "bullish" as const;
  if (signal === "BEARISH") return "bearish" as const;
  return "neutral" as const;
}

function momentumTone(m: ScanResult["analysis"]["momentum"]) {
  if (m === "STRONG" || m === "MODERATE") return "bullish" as const;
  if (m === "NEGATIVE") return "bearish" as const;
  return "neutral" as const;
}

function trendTone(t: ScanResult["analysis"]["trend"]) {
  if (t === "UPTREND") return "bullish" as const;
  if (t === "DOWNTREND") return "bearish" as const;
  return "neutral" as const;
}

function riskTone(r: ScanResult["analysis"]["riskLevel"]) {
  if (r === "LOW") return "bullish" as const;
  if (r === "HIGH") return "bearish" as const;
  return "neutral" as const;
}

export default function StockScanner() {
  const params = useSearchParams();
  const initialTicker = params.get("ticker") ?? "";

  const [ticker, setTicker] = useState(initialTicker);
  const [focus, setFocus] = useState<Set<ScanFocusArea>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);

  useEffect(() => {
    if (initialTicker) setTicker(initialTicker);
  }, [initialTicker]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: ticker.trim().toUpperCase(),
          focusAreas: Array.from(focus),
        }),
      });
      const data = (await res.json()) as ScanResult & { error?: string };
      if (!res.ok || data.error) {
        setError(data.error || `HTTP ${res.status}`);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-4">
        <div className="flex gap-2">
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="Enter ticker (e.g. AAPL)"
            className="flex-1 bg-panel border border-border rounded-md px-4 py-3 font-mono uppercase placeholder:text-gray-600 focus:outline-none focus:border-white/40"
          />
          <button
            type="submit"
            disabled={loading || !ticker.trim()}
            className="bg-white text-black font-semibold px-6 py-3 rounded-md disabled:opacity-40"
          >
            {loading ? "Analyzing…" : "Scan"}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {FOCUS_AREAS.map((area) => {
            const active = focus.has(area);
            return (
              <button
                key={area}
                type="button"
                onClick={() => {
                  setFocus((prev) => {
                    const next = new Set(prev);
                    if (next.has(area)) next.delete(area);
                    else next.add(area);
                    return next;
                  });
                }}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  active
                    ? "bg-white text-black border-white"
                    : "border-border text-gray-400 hover:border-white/40"
                }`}
              >
                {area}
              </button>
            );
          })}
        </div>
      </form>

      {error && (
        <div className="border border-loss/40 text-loss rounded-md p-4 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold mb-1">{result.ticker}</h2>
            <div className="text-sm text-gray-400 font-mono">
              ${result.quote.price.toFixed(2)} · YTD{" "}
              {result.quote.ytdReturn.toFixed(1)}% · Vol{" "}
              {result.quote.volumeRatio.toFixed(2)}x
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SignalCard
              label="Signal"
              value={`${result.analysis.overallSignal} (${result.analysis.signalStrength}/10)`}
              tone={signalTone(result.analysis.overallSignal)}
            />
            <SignalCard
              label="Momentum"
              value={result.analysis.momentum}
              tone={momentumTone(result.analysis.momentum)}
            />
            <SignalCard
              label="Trend"
              value={result.analysis.trend}
              tone={trendTone(result.analysis.trend)}
            />
            <SignalCard
              label="Risk"
              value={result.analysis.riskLevel}
              tone={riskTone(result.analysis.riskLevel)}
            />
          </div>

          <div className="border border-border rounded-md p-5 bg-panel space-y-4">
            <div>
              <div className="text-xs uppercase text-gray-400 mb-1">Summary</div>
              <p className="text-sm leading-relaxed">
                {result.analysis.summary}
              </p>
            </div>

            {result.analysis.keyPoints?.length > 0 && (
              <div>
                <div className="text-xs uppercase text-gray-400 mb-1">
                  Key Points
                </div>
                <ul className="text-sm space-y-1">
                  {result.analysis.keyPoints.map((kp, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-gray-500">·</span>
                      <span>{kp}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs uppercase text-gray-400 mb-1">
                  Watch Level
                </div>
                <div className="font-mono">{result.analysis.watchLevel}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-400 mb-1">
                  Timeframe
                </div>
                <div>{result.analysis.timeframe}</div>
              </div>
            </div>

            {result.analysis.catalysts?.length > 0 && (
              <div>
                <div className="text-xs uppercase text-gray-400 mb-1">
                  Catalysts
                </div>
                <ul className="text-sm space-y-1">
                  {result.analysis.catalysts.map((c, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-gray-500">·</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
