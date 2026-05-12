import type { StockQuote, TickerQuote } from "@/types";

const BASE = "https://api.polygon.io";

function key(): string {
  const k = process.env.POLYGON_API_KEY || process.env.NEXT_PUBLIC_POLYGON_API_KEY;
  if (!k) throw new Error("POLYGON_API_KEY is not set");
  return k;
}

async function pget<T>(path: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${BASE}${path}${sep}apiKey=${key()}`;
  const res = await fetch(url, { next: { revalidate: 30 } });
  if (!res.ok) {
    throw new Error(`Polygon ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

type SnapshotResp = {
  tickers?: Array<{
    ticker: string;
    day?: { c?: number };
    prevDay?: { c?: number };
    lastTrade?: { p?: number };
    todaysChange?: number;
    todaysChangePerc?: number;
  }>;
};

export async function getTickerSnapshots(tickers: string[]): Promise<TickerQuote[]> {
  const list = tickers.join(",");
  const data = await pget<SnapshotResp>(
    `/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${encodeURIComponent(list)}`
  );
  return (data.tickers ?? []).map((t) => {
    const price = t.lastTrade?.p ?? t.day?.c ?? t.prevDay?.c ?? 0;
    return {
      ticker: t.ticker,
      price,
      change: t.todaysChange ?? 0,
      changePercent: t.todaysChangePerc ?? 0,
    };
  });
}

type AggsResp = {
  results?: Array<{ c: number; v: number; t: number; h: number; l: number }>;
};

export async function getCurrentPrice(ticker: string): Promise<number | null> {
  try {
    const snaps = await getTickerSnapshots([ticker]);
    if (snaps[0]?.price) return snaps[0].price;
  } catch {}
  // Fallback to previous close
  try {
    const data = await pget<AggsResp>(`/v2/aggs/ticker/${ticker}/prev`);
    return data.results?.[0]?.c ?? null;
  } catch {
    return null;
  }
}

export async function getDailyBars(
  ticker: string,
  from: string,
  to: string
): Promise<Array<{ t: number; c: number }>> {
  const data = await pget<AggsResp>(
    `/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=400`
  );
  return (data.results ?? []).map((r) => ({ t: r.t, c: r.c }));
}

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export async function getStockQuote(ticker: string): Promise<StockQuote> {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const start = new Date(now);
  start.setDate(start.getDate() - 400);
  const from = start.toISOString().slice(0, 10);

  const bars = await getDailyBars(ticker, from, to);
  if (bars.length === 0) {
    throw new Error(`No price data for ${ticker}`);
  }

  const closes = bars.map((b) => b.c);
  const last = closes[closes.length - 1];
  const high52 = Math.max(...closes.slice(-252));
  const low52 = Math.min(...closes.slice(-252));
  const ma50 = avg(closes.slice(-50));
  const ma200 = avg(closes.slice(-200));

  const ytdStart = new Date(now.getFullYear(), 0, 1).getTime();
  const ytdBar = bars.find((b) => b.t >= ytdStart) ?? bars[0];
  const ytdReturn = ytdBar ? ((last - ytdBar.c) / ytdBar.c) * 100 : 0;

  // Volume snapshot
  let volume = 0;
  let avgVolume = 0;
  try {
    const volData = await pget<AggsResp>(
      `/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=desc&limit=50`
    );
    const vols = (volData.results ?? []).map((r) => r.v);
    volume = vols[0] ?? 0;
    avgVolume = vols.length ? avg(vols) : 0;
  } catch {}

  return {
    ticker,
    price: last,
    high52,
    low52,
    ma50,
    ma200,
    volume,
    avgVolume,
    volumeRatio: avgVolume ? volume / avgVolume : 1,
    ytdReturn,
  };
}

type FinancialsResp = {
  results?: Array<{
    start_date?: string;
    end_date?: string;
    filing_date?: string;
    financials?: {
      income_statement?: {
        basic_earnings_per_share?: { value?: number };
        revenues?: { value?: number };
      };
    };
  }>;
};

export type PolygonEarning = {
  ticker: string;
  reportDate: string;
  epsActual: number | null;
  revenueActual: number | null;
};

export async function getRecentEarnings(
  ticker: string,
  limit = 4
): Promise<PolygonEarning[]> {
  try {
    const data = await pget<FinancialsResp>(
      `/vX/reference/financials?ticker=${ticker}&timeframe=quarterly&limit=${limit}&order=desc`
    );
    return (data.results ?? []).map((r) => ({
      ticker,
      reportDate: r.filing_date ?? r.end_date ?? "",
      epsActual: r.financials?.income_statement?.basic_earnings_per_share?.value ?? null,
      revenueActual: r.financials?.income_statement?.revenues?.value ?? null,
    }));
  } catch {
    return [];
  }
}
