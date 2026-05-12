import Anthropic from "@anthropic-ai/sdk";
import type {
  EarningsAnalysis,
  ScanAnalysis,
  ScanFocusArea,
  StockQuote,
} from "@/types";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    client = new Anthropic();
  }
  return client;
}

const MODEL = "claude-sonnet-4-5";

function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`No JSON found in: ${text.slice(0, 200)}`);
  }
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

export async function analyzeStock(
  quote: StockQuote,
  focusAreas: ScanFocusArea[]
): Promise<ScanAnalysis> {
  const prompt = `You are a professional stock analyst. Analyze ${quote.ticker} based on this real market data:
- Current Price: $${quote.price.toFixed(2)}
- 52-week High: $${quote.high52.toFixed(2)}
- 52-week Low: $${quote.low52.toFixed(2)}
- 50-day MA: $${quote.ma50.toFixed(2)}
- 200-day MA: $${quote.ma200.toFixed(2)}
- Volume vs Avg: ${quote.volumeRatio.toFixed(2)}x
- YTD Return: ${quote.ytdReturn.toFixed(2)}%

User focus areas: ${focusAreas.length ? focusAreas.join(", ") : "General"}

Respond ONLY with raw JSON (no markdown fences) matching this exact schema:
{
  "overallSignal": "BULLISH" | "BEARISH" | "NEUTRAL",
  "signalStrength": <integer 1-10>,
  "momentum": "STRONG" | "MODERATE" | "WEAK" | "NEGATIVE",
  "trend": "UPTREND" | "DOWNTREND" | "SIDEWAYS",
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "timeframe": "SHORT" | "MEDIUM" | "LONG",
  "summary": "3-4 sentence analyst take",
  "keyPoints": ["signal 1", "signal 2", "signal 3"],
  "watchLevel": "key price level as string",
  "catalysts": ["catalyst 1", "catalyst 2"]
}`;

  const resp = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return extractJson<ScanAnalysis>(text);
}

export type EarningsAnalysisInput = {
  ticker: string;
  reportDate: string;
  epsActual: number | null;
  epsEstimate: number | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
};

export async function analyzeEarnings(
  input: EarningsAnalysisInput
): Promise<EarningsAnalysis> {
  const fmt = (n: number | null, digits = 2) =>
    n === null || n === undefined ? "N/A" : n.toFixed(digits);

  const epsBeat =
    input.epsActual !== null && input.epsEstimate !== null
      ? input.epsActual >= input.epsEstimate
      : null;
  const revBeat =
    input.revenueActual !== null && input.revenueEstimate !== null
      ? input.revenueActual >= input.revenueEstimate
      : null;

  const prompt = `Analyze this earnings report for ${input.ticker}:
- EPS: $${fmt(input.epsActual)} vs estimate $${fmt(input.epsEstimate)} (${epsBeat === null ? "N/A" : epsBeat ? "BEAT" : "MISS"})
- Revenue: $${fmt(input.revenueActual ? input.revenueActual / 1e9 : null)}B vs estimate $${fmt(input.revenueEstimate ? input.revenueEstimate / 1e9 : null)}B (${revBeat === null ? "N/A" : revBeat ? "BEAT" : "MISS"})
- Report date: ${input.reportDate}

Provide a 3-4 sentence analyst take on what this means for the stock. Include quality of the beat/miss, what to watch going forward, and overall sentiment.

Respond ONLY with raw JSON (no markdown fences) matching:
{
  "summary": "...",
  "sentiment": "POSITIVE" | "NEGATIVE" | "MIXED",
  "keyTakeaways": ["...", "..."],
  "outlookStatement": "..."
}`;

  const resp = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return extractJson<EarningsAnalysis>(text);
}
