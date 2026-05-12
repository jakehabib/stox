import { NextResponse } from "next/server";
import { getTickerSnapshots } from "@/lib/polygon";

export const runtime = "nodejs";
export const revalidate = 30;

const DEFAULT_TICKERS = [
  "SPY",
  "QQQ",
  "AAPL",
  "NVDA",
  "TSLA",
  "META",
  "AMZN",
  "GOOGL",
  "MSFT",
];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const param = url.searchParams.get("tickers");
  const tickers = param ? param.split(",").map((t) => t.trim().toUpperCase()) : DEFAULT_TICKERS;

  try {
    const quotes = await getTickerSnapshots(tickers);
    return NextResponse.json({ quotes });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ quotes: [], error: message }, { status: 500 });
  }
}
