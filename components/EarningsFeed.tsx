"use client";

import { useEffect, useState } from "react";
import type { EarningsAnalysis, EarningsReport } from "@/types";

function fmtMoney(n: number | null, scale: "raw" | "billions" = "raw"): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (scale === "billions") return `$${(n / 1e9).toFixed(2)}B`;
  return `$${n.toFixed(2)}`;
}

type ReportWithAnalysis = EarningsReport & {
  analysisLoading?: boolean;
  analysisError?: string;
  analysis?: EarningsAnalysis | null;
};

export default function EarningsFeed() {
  const [reports, setReports] = useState<ReportWithAnalysis[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/earnings");
        const data = (await res.json()) as {
          reports?: EarningsReport[];
          error?: string;
        };
        if (data.error) setError(data.error);
        const mapped: ReportWithAnalysis[] = (data.reports ?? []).map((r) => ({
          ...r,
          analysis: r.aiSummary
            ? {
                summary: r.aiSummary,
                sentiment: r.sentiment ?? "MIXED",
                keyTakeaways: r.keyTakeaways ?? [],
                outlookStatement: r.outlookStatement ?? "",
              }
            : null,
        }));
        setReports(mapped);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
        setReports([]);
      }
    }
    load();
  }, []);

  async function runAnalysis(idx: number) {
    if (!reports) return;
    const r = reports[idx];
    setReports((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], analysisLoading: true, analysisError: undefined };
      return next;
    });
    try {
      const res = await fetch("/api/earnings/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: r.ticker,
          reportDate: r.reportDate,
          epsActual: r.epsActual,
          epsEstimate: r.epsEstimate,
          revenueActual: r.revenueActual,
          revenueEstimate: r.revenueEstimate,
        }),
      });
      const data = (await res.json()) as {
        analysis?: EarningsAnalysis;
        error?: string;
      };
      setReports((prev) => {
        if (!prev) return prev;
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          analysisLoading: false,
          analysisError: data.error,
          analysis: data.analysis ?? null,
        };
        return next;
      });
    } catch (err) {
      setReports((prev) => {
        if (!prev) return prev;
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          analysisLoading: false,
          analysisError: err instanceof Error ? err.message : "Failed",
        };
        return next;
      });
    }
  }

  if (reports === null) {
    return (
      <div className="border border-border rounded-md p-6 text-sm text-gray-400">
        Loading earnings…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-xs text-loss border border-loss/40 rounded p-2">
          {error}
        </div>
      )}
      {reports.length === 0 && (
        <div className="text-sm text-gray-400">No earnings found.</div>
      )}
      {reports.map((r, idx) => {
        const epsBeat =
          r.epsActual !== null && r.epsEstimate !== null
            ? r.epsActual >= r.epsEstimate
            : null;
        return (
          <div
            key={`${r.ticker}-${r.reportDate}-${idx}`}
            className="border border-border rounded-md p-5 bg-panel space-y-3"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xl font-semibold">{r.ticker}</div>
                <div className="text-xs text-gray-400">{r.reportDate}</div>
              </div>
              {epsBeat !== null && (
                <span
                  className={`text-xs font-semibold px-2 py-1 rounded ${
                    epsBeat
                      ? "bg-gain/20 text-gain"
                      : "bg-loss/20 text-loss"
                  }`}
                >
                  {epsBeat ? "BEAT" : "MISS"}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs uppercase text-gray-400">EPS</div>
                <div className="font-mono">
                  {fmtMoney(r.epsActual)} vs {fmtMoney(r.epsEstimate)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-400">Revenue</div>
                <div className="font-mono">
                  {fmtMoney(r.revenueActual, "billions")} vs{" "}
                  {fmtMoney(r.revenueEstimate, "billions")}
                </div>
              </div>
            </div>

            {r.analysis ? (
              <div className="pt-3 border-t border-border space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase text-gray-400">
                    AI Analysis
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      r.analysis.sentiment === "POSITIVE"
                        ? "bg-gain/20 text-gain"
                        : r.analysis.sentiment === "NEGATIVE"
                          ? "bg-loss/20 text-loss"
                          : "bg-yellow-400/20 text-yellow-400"
                    }`}
                  >
                    {r.analysis.sentiment}
                  </span>
                </div>
                <p className="text-sm leading-relaxed">{r.analysis.summary}</p>
                {r.analysis.outlookStatement && (
                  <p className="text-xs text-gray-400 italic">
                    {r.analysis.outlookStatement}
                  </p>
                )}
              </div>
            ) : (
              <div className="pt-3 border-t border-border">
                <button
                  onClick={() => runAnalysis(idx)}
                  disabled={r.analysisLoading}
                  className="text-xs border border-border hover:border-white/40 rounded px-3 py-1.5 disabled:opacity-40"
                >
                  {r.analysisLoading ? "Analyzing…" : "Run AI Analysis"}
                </button>
                {r.analysisError && (
                  <div className="text-xs text-loss mt-2">
                    {r.analysisError}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
