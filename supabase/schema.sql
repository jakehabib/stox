-- Portfolio holdings
create table if not exists portfolio (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  company_name text not null,
  pick_date date not null,
  entry_price numeric not null,
  thesis text not null,
  created_at timestamp default now()
);

-- Scan history
create table if not exists scans (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  signal text not null,
  signal_strength integer,
  summary text,
  raw_analysis jsonb,
  created_at timestamp default now()
);

-- Earnings analysis cache
create table if not exists earnings_analysis (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  report_date date not null,
  eps_actual numeric,
  eps_estimate numeric,
  revenue_actual numeric,
  revenue_estimate numeric,
  ai_summary text,
  sentiment text,
  created_at timestamp default now(),
  unique (ticker, report_date)
);
