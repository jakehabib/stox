import { NextResponse } from "next/server";
import { analyzeEarnings } from "@/lib/claude";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      ticker?: string;
      reportDate?: string;
      epsActual?: number | null;
      epsEstimate?: number | null;
      revenueActual?: number | null;
      revenueEstimate?: number | null;
    };

    const ticker = body.ticker?.trim().toUpperCase();
    if (!ticker || !body.reportDate) {
      return NextResponse.json(
        { error: "ticker and reportDate are required" },
        { status: 400 }
      );
    }

    const analysis = await analyzeEarnings({
      ticker,
      reportDate: body.reportDate,
      epsActual: body.epsActual ?? null,
      epsEstimate: body.epsEstimate ?? null,
      revenueActual: body.revenueActual ?? null,
      revenueEstimate: body.revenueEstimate ?? null,
    });

    const sb = getSupabaseAdmin();
    if (sb) {
      await sb.from("earnings_analysis").upsert({
        ticker,
        report_date: body.reportDate,
        eps_actual: body.epsActual,
        eps_estimate: body.epsEstimate,
        revenue_actual: body.revenueActual,
        revenue_estimate: body.revenueEstimate,
        ai_summary: analysis.summary,
        sentiment: analysis.sentiment,
      });
    }

    return NextResponse.json({ analysis });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
