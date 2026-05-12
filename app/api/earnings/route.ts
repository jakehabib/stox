import { NextResponse } from "next/server";
import { getRecentEarnings } from "@/lib/polygon";
import { getSupabase, SEED_PORTFOLIO } from "@/lib/supabase";
import type { EarningsReport, PortfolioHolding } from "@/types";

export const runtime = "nodejs";

async function loadTickers(): Promise<string[]> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from("portfolio").select("ticker");
    if (!error && data && data.length > 0) {
      return (data as Array<Pick<PortfolioHolding, "ticker">>).map((d) => d.ticker);
    }
  }
  return SEED_PORTFOLIO.map((h) => h.ticker);
}

async function loadCachedAnalysis(): Promise<Map<string, Partial<EarningsReport>>> {
  const sb = getSupabase();
  if (!sb) return new Map();
  const { data, error } = await sb.from("earnings_analysis").select("*");
  if (error || !data) return new Map();
  const map = new Map<string, Partial<EarningsReport>>();
  for (const row of data as Array<{
    ticker: string;
    report_date: string;
    ai_summary?: string;
    sentiment?: EarningsReport["sentiment"];
  }>) {
    map.set(`${row.ticker}:${row.report_date}`, {
      aiSummary: row.ai_summary ?? null,
      sentiment: row.sentiment ?? null,
    });
  }
  return map;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const param = url.searchParams.get("tickers");
  const tickers = param
    ? param.split(",").map((t) => t.trim().toUpperCase())
    : await loadTickers();

  try {
    const cache = await loadCachedAnalysis();
    const reports: EarningsReport[] = [];

    for (const ticker of tickers) {
      const earnings = await getRecentEarnings(ticker, 4);
      for (const e of earnings) {
        const cached = cache.get(`${e.ticker}:${e.reportDate}`) ?? {};
        reports.push({
          ticker: e.ticker,
          reportDate: e.reportDate,
          epsActual: e.epsActual,
          epsEstimate: null,
          revenueActual: e.revenueActual,
          revenueEstimate: null,
          aiSummary: cached.aiSummary ?? null,
          sentiment: cached.sentiment ?? null,
        });
      }
    }

    reports.sort((a, b) => b.reportDate.localeCompare(a.reportDate));
    return NextResponse.json({ reports });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ reports: [], error: message }, { status: 500 });
  }
}
