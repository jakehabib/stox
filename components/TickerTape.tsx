"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { TickerQuote } from "@/types";

export default function TickerTape() {
  const [quotes, setQuotes] = useState<TickerQuote[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/ticker-prices");
        if (!res.ok) return;
        const data = (await res.json()) as { quotes: TickerQuote[] };
        if (!cancelled) setQuotes(data.quotes || []);
      } catch {}
    }

    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (quotes.length === 0) {
    return (
      <div className="h-9 border-b border-border bg-black text-xs text-gray-500 flex items-center px-4 font-mono">
        Loading market data…
      </div>
    );
  }

  // Duplicate the list for seamless marquee loop.
  const items = [...quotes, ...quotes];

  return (
    <div className="h-9 border-b border-border bg-black overflow-hidden relative">
      <div className="absolute inset-0 flex items-center animate-marquee whitespace-nowrap">
        {items.map((q, i) => {
          const positive = q.changePercent >= 0;
          return (
            <Link
              key={`${q.ticker}-${i}`}
              href={`/scanner?ticker=${q.ticker}`}
              className="inline-flex items-baseline gap-2 px-4 font-mono text-xs hover:bg-white/5"
            >
              <span className="text-white font-semibold">{q.ticker}</span>
              <span className="text-gray-300">${q.price.toFixed(2)}</span>
              <span className={positive ? "text-gain" : "text-loss"}>
                {positive ? "+" : ""}
                {q.changePercent.toFixed(2)}%
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
