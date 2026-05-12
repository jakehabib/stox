import { NextResponse } from "next/server";
import { getCurrentPrice, getTickerSnapshots } from "@/lib/polygon";
import { getSupabase, SEED_PORTFOLIO } from "@/lib/supabase";
import type { EnrichedHolding, PortfolioHolding } from "@/types";

export const runtime = "nodejs";

async function loadHoldings(): Promise<PortfolioHolding[]> {
  const sb = getSupabase();
  if (!sb) return SEED_PORTFOLIO;
  const { data, error } = await sb
    .from("portfolio")
    .select("*")
    .order("pick_date", { ascending: true });
  if (error || !data || data.length === 0) return SEED_PORTFOLIO;
  return data as PortfolioHolding[];
}

export async function GET() {
  try {
    const holdings = await loadHoldings();
    const tickers = holdings.map((h) => h.ticker);

    let priceMap = new Map<string, number>();
    try {
      const snaps = await getTickerSnapshots(tickers);
      for (const s of snaps) priceMap.set(s.ticker, s.price);
    } catch {}

    const enriched: EnrichedHolding[] = await Promise.all(
      holdings.map(async (h) => {
        let price = priceMap.get(h.ticker) ?? null;
        if (price === null || price === 0) {
          price = await getCurrentPrice(h.ticker);
        }
        const returnDollars = price !== null ? price - h.entry_price : null;
        const returnPercent =
          price !== null ? ((price - h.entry_price) / h.entry_price) * 100 : null;
        return {
          ...h,
          currentPrice: price,
          returnDollars,
          returnPercent,
        };
      })
    );

    return NextResponse.json({ holdings: enriched });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ holdings: [], error: message }, { status: 500 });
  }
}
