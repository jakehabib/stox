import { NextResponse } from "next/server";
import { analyzeStock } from "@/lib/claude";
import { getStockQuote } from "@/lib/polygon";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { ScanFocusArea } from "@/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      ticker?: string;
      focusAreas?: ScanFocusArea[];
    };
    const ticker = body.ticker?.trim().toUpperCase();
    if (!ticker) {
      return NextResponse.json({ error: "ticker is required" }, { status: 400 });
    }
    const focusAreas = body.focusAreas ?? [];

    const quote = await getStockQuote(ticker);
    const analysis = await analyzeStock(quote, focusAreas);

    const sb = getSupabaseAdmin();
    if (sb) {
      await sb.from("scans").insert({
        ticker,
        signal: analysis.overallSignal,
        signal_strength: analysis.signalStrength,
        summary: analysis.summary,
        raw_analysis: analysis,
      });
    }

    return NextResponse.json({ ticker, quote, analysis });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
