export type TickerQuote = {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
};

export type PortfolioHolding = {
  id?: string;
  ticker: string;
  company_name: string;
  pick_date: string;
  entry_price: number;
  thesis: string;
};

export type EnrichedHolding = PortfolioHolding & {
  currentPrice: number | null;
  returnPercent: number | null;
  returnDollars: number | null;
};

export type StockQuote = {
  ticker: string;
  price: number;
  high52: number;
  low52: number;
  ma50: number;
  ma200: number;
  volume: number;
  avgVolume: number;
  volumeRatio: number;
  ytdReturn: number;
};

export type ScanFocusArea =
  | "Momentum"
  | "Trend Strength"
  | "Risk/Reward"
  | "Earnings Catalyst"
  | "Short Squeeze"
  | "Breakout Setup";

export type ScanAnalysis = {
  overallSignal: "BULLISH" | "BEARISH" | "NEUTRAL";
  signalStrength: number;
  momentum: "STRONG" | "MODERATE" | "WEAK" | "NEGATIVE";
  trend: "UPTREND" | "DOWNTREND" | "SIDEWAYS";
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  timeframe: "SHORT" | "MEDIUM" | "LONG";
  summary: string;
  keyPoints: string[];
  watchLevel: string;
  catalysts: string[];
};

export type ScanResult = {
  ticker: string;
  quote: StockQuote;
  analysis: ScanAnalysis;
};

export type EarningsReport = {
  ticker: string;
  reportDate: string;
  epsActual: number | null;
  epsEstimate: number | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
  aiSummary?: string | null;
  sentiment?: "POSITIVE" | "NEGATIVE" | "MIXED" | null;
  keyTakeaways?: string[] | null;
  outlookStatement?: string | null;
};

export type EarningsAnalysis = {
  summary: string;
  sentiment: "POSITIVE" | "NEGATIVE" | "MIXED";
  keyTakeaways: string[];
  outlookStatement: string;
};
