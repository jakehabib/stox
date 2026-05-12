import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { PortfolioHolding } from "@/types";

let _client: SupabaseClient | null = null;
let _admin: SupabaseClient | null = null;

export function hasSupabase(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function getSupabase(): SupabaseClient | null {
  if (!hasSupabase()) return null;
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _client;
}

export function getSupabaseAdmin(): SupabaseClient | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return null;
  }
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );
  }
  return _admin;
}

// Seed portfolio used when Supabase is not configured, or as the initial seed.
export const SEED_PORTFOLIO: PortfolioHolding[] = [
  {
    ticker: "NVDA",
    company_name: "NVIDIA Corporation",
    pick_date: "2024-01-01",
    entry_price: 49.52,
    thesis:
      "Dominant AI infrastructure play with pricing power and a widening moat via CUDA ecosystem.",
  },
  {
    ticker: "MSFT",
    company_name: "Microsoft Corporation",
    pick_date: "2024-01-01",
    entry_price: 374.0,
    thesis:
      "Best enterprise AI distribution through Azure and Copilot; recurring revenue with sticky customers.",
  },
  {
    ticker: "META",
    company_name: "Meta Platforms, Inc.",
    pick_date: "2024-01-01",
    entry_price: 353.0,
    thesis:
      "Undervalued AI advertiser with massive data moat and Reality Labs as a free optionality bet.",
  },
  {
    ticker: "AMZN",
    company_name: "Amazon.com, Inc.",
    pick_date: "2024-01-01",
    entry_price: 153.0,
    thesis:
      "AWS growth reaccelerating; retail margin expansion story still underappreciated.",
  },
  {
    ticker: "AAPL",
    company_name: "Apple Inc.",
    pick_date: "2024-01-01",
    entry_price: 185.0,
    thesis:
      "Services flywheel compounding quietly; AI features will drive next upgrade cycle.",
  },
  {
    ticker: "PLTR",
    company_name: "Palantir Technologies",
    pick_date: "2024-01-01",
    entry_price: 16.5,
    thesis:
      "Government + enterprise AI platform with unique data integration moat.",
  },
  {
    ticker: "TSM",
    company_name: "Taiwan Semiconductor",
    pick_date: "2024-01-01",
    entry_price: 102.0,
    thesis:
      "Irreplaceable semiconductor manufacturer; every AI chip runs through TSMC.",
  },
  {
    ticker: "SPOT",
    company_name: "Spotify Technology",
    pick_date: "2024-01-01",
    entry_price: 196.0,
    thesis:
      "Gross margin inflecting upward; podcast + audiobook bets paying off.",
  },
];
