"use client";

import { useEffect, useState } from "react";
import type { EnrichedHolding } from "@/types";

function fmtPct(n: number | null): string {
  if (n === null || Number.isNaN(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtPrice(n: number | null): string {
  if (n === null || Number.isNaN(n)) return "—";
  return `$${n.toFixed(2)}`;
}

export default function PortfolioTable() {
  const [holdings, setHoldings] = useState<EnrichedHolding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/portfolio");
        const data = (await res.json()) as {
          holdings?: EnrichedHolding[];
          error?: string;
        };
        if (data.error) setError(data.error);
        setHoldings(data.holdings ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
        setHoldings([]);
      }
    }
    load();
  }, []);

  if (holdings === null) {
    return (
      <div className="border border-border rounded-md p-6 text-sm text-gray-400">
        Loading portfolio…
      </div>
    );
  }

  const totalReturn =
    holdings.length > 0
      ? holdings.reduce((sum, h) => sum + (h.returnPercent ?? 0), 0) /
        holdings.filter((h) => h.returnPercent !== null).length
      : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="border border-border rounded-md p-4 bg-panel">
          <div className="text-xs uppercase tracking-wide text-gray-400">
            Avg Return
          </div>
          <div
            className={`text-2xl font-semibold ${
              totalReturn >= 0 ? "text-gain" : "text-loss"
            }`}
          >
            {fmtPct(totalReturn)}
          </div>
        </div>
        <div className="border border-border rounded-md p-4 bg-panel">
          <div className="text-xs uppercase tracking-wide text-gray-400">
            Holdings
          </div>
          <div className="text-2xl font-semibold">{holdings.length}</div>
        </div>
        <div className="border border-border rounded-md p-4 bg-panel">
          <div className="text-xs uppercase tracking-wide text-gray-400">
            Winners
          </div>
          <div className="text-2xl font-semibold">
            {holdings.filter((h) => (h.returnPercent ?? 0) > 0).length}/
            {holdings.length}
          </div>
        </div>
      </div>

      {error && (
        <div className="text-xs text-loss border border-loss/40 rounded p-2">
          {error}
        </div>
      )}

      <div className="border border-border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-panel text-gray-400 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Ticker</th>
              <th className="text-right px-4 py-3">Entry</th>
              <th className="text-right px-4 py-3">Current</th>
              <th className="text-right px-4 py-3">Return</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">
                Thesis
              </th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => {
              const isOpen = expanded.has(h.ticker);
              const positive = (h.returnPercent ?? 0) >= 0;
              return (
                <tr
                  key={h.ticker}
                  className="border-t border-border hover:bg-white/[0.02] cursor-pointer"
                  onClick={() => {
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(h.ticker)) next.delete(h.ticker);
                      else next.add(h.ticker);
                      return next;
                    });
                  }}
                >
                  <td className="px-4 py-3">
                    <div className="font-semibold">{h.ticker}</div>
                    <div className="text-xs text-gray-500">{h.company_name}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {fmtPrice(h.entry_price)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {fmtPrice(h.currentPrice)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${
                      positive ? "text-gain" : "text-loss"
                    }`}
                  >
                    {fmtPct(h.returnPercent)}
                  </td>
                  <td className="px-4 py-3 text-gray-400 hidden md:table-cell max-w-md">
                    <div className={isOpen ? "" : "truncate"}>{h.thesis}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
