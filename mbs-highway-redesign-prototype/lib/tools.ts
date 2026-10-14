/**
 * Single registry of every user-facing tool. Drives the sidebar, the global search,
 * the tool switcher, section hubs and the README route map.
 */

export type Section =
  | 'Home'
  | 'Market Analysis'
  | 'Clients'
  | 'Strike Rate'
  | 'Loan Comparison'
  | 'Real Estate'
  | 'Calculators'
  | 'Marketing'
  | 'Agent Feed'
  | 'Get Help';

export type ToolStatus = 'built' | 'reimagined' | 'inferred' | 'display-only' | 'external';

export interface Tool {
  id: string;
  name: string;
  href: string;
  section: Section;
  blurb: string;
  keywords?: string[];
  status: ToolStatus;
  /** Icon key from lucide-react (resolved in components/icons.tsx). */
  icon: string;
  external?: boolean;
}

export const TOOLS: Tool[] = [
  { id: 'homepage', name: 'Dashboard', href: '/members/homepage', section: 'Home', blurb: 'Daily update, locked-in rates, quick access', status: 'built', icon: 'home' },

  { id: 'markets', name: 'Markets Overview', href: '/members/markets', section: 'Market Analysis', blurb: 'MBS chart, bonds, stocks, treasury curve', status: 'built', icon: 'candlestick', keywords: ['mbs', 'bonds', 'ticker', 'umbs', '10 year'] },
  { id: 'econ-calendar', name: 'Economic Calendar', href: '/members/econ-calendar', section: 'Market Analysis', blurb: 'This week’s reports and events', status: 'built', icon: 'calendar', keywords: ['cpi', 'jobs', 'fed', 'reports'] },
  { id: 'morning-update', name: 'Morning Update', href: '/members/morning-update', section: 'Market Analysis', blurb: 'Daily video and article', status: 'built', icon: 'sunrise', keywords: ['daily', 'video'] },
  { id: 'market-wrap', name: 'Market Wrap', href: '/members/market-wrap', section: 'Market Analysis', blurb: 'End-of-day recap', status: 'built', icon: 'newspaper' },
  { id: 'mauldin', name: 'Mauldin: Thoughts from the Frontline', href: '/members/mauldin', section: 'Market Analysis', blurb: 'Long-form macro newsletter', status: 'built', icon: 'book-open', keywords: ['newsletter', 'macro'] },
  { id: 'barrys-insights', name: 'Barry’s Insights', href: '/members/barrys-insights', section: 'Market Analysis', blurb: 'Webinar video archive', status: 'built', icon: 'video', keywords: ['barry habib', 'webinar'] },

  { id: 'client-manager', name: 'Client Manager', href: '/members/client-manager', section: 'Clients', blurb: 'Your clients and their activity', status: 'built', icon: 'users', keywords: ['crm', 'contacts', 'add client'] },
  { id: 'meet', name: 'Meet', href: '/members/meet', section: 'Clients', blurb: 'Highway Meeting', status: 'display-only', icon: 'presentation', keywords: ['meeting', 'host'] },
  { id: 'recordings', name: 'Recordings', href: '/members/recordings', section: 'Clients', blurb: 'Saved meeting recordings', status: 'built', icon: 'film' },

  { id: 'strike-rate', name: 'Strike Rate', href: '/members/strike-rate', section: 'Strike Rate', blurb: 'Refi-opportunity rate alerts', status: 'built', icon: 'target', keywords: ['lock', 'alert', 'refi'] },

  { id: 'loan-compare', name: 'Loan Comparison', href: '/members/loan-compare', section: 'Loan Comparison', blurb: 'True cost comparison of loan options', status: 'built', icon: 'columns', keywords: ['property comparison', 'compare', 'true cost'] },
  { id: 'purchase-analysis', name: 'Purchase Analysis', href: '/members/purchase-analysis', section: 'Loan Comparison', blurb: 'Guided property → loan → co-brand wizard', status: 'built', icon: 'clipboard', keywords: ['wizard', 'purchase'] },
  { id: 'cost-of-waiting', name: 'Cost of Waiting', href: '/members/cost-of-waiting', section: 'Loan Comparison', blurb: 'What waiting to buy really costs', status: 'built', icon: 'hourglass', keywords: ['wait', 'cow'] },
  { id: 'refi-cow-express', name: 'Refi Risk of Waiting', href: '/members/refi-cow-express', section: 'Loan Comparison', blurb: 'Cost of delaying a refinance', status: 'built', icon: 'refresh', keywords: ['refinance', 'refi'] },

  { id: 'rerc', name: 'Real Estate Report Card', href: '/members/rerc', section: 'Real Estate', blurb: 'Local market snapshot by ZIP', status: 'built', icon: 'map-pin', keywords: ['community report', 'rerc', 'market data', 'inventory'] },
  { id: 'buy-vs-rent', name: 'Buy vs Rent', href: '/members/buy-vs-rent', section: 'Real Estate', blurb: 'Wealth built by owning vs renting', status: 'built', icon: 'scale', keywords: ['rent', 'renting'] },
  { id: 'appreciation', name: 'Appreciation', href: '/members/appreciation', section: 'Real Estate', blurb: 'Future home value and ROI', status: 'built', icon: 'trending-up' },
  { id: 'equity-gained', name: 'Equity Gained & Appreciation', href: '/members/equity-gained', section: 'Real Estate', blurb: 'Equity from appreciation + principal', status: 'built', icon: 'piggy-bank', keywords: ['equity'] },
  { id: 'bid-over-ask', name: 'Bid Over Ask', href: '/members/bid-over-ask', section: 'Real Estate', blurb: 'When value catches up to an over-ask bid', status: 'built', icon: 'gavel', keywords: ['offer', 'over asking'] },
  { id: 'house-price-index', name: 'House Price Index', href: '/members/house-price-index', section: 'Real Estate', blurb: 'FHFA price changes by state', status: 'built', icon: 'map', keywords: ['hpi', 'fhfa', 'home appreciation map'] },
  { id: 'investment-property-analyzer', name: 'Investment Property Analyzer', href: '/members/investment-property-analyzer', section: 'Real Estate', blurb: 'Cap rate and cash-on-cash return', status: 'inferred', icon: 'building', keywords: ['rental', 'cap rate', 'investor'] },
  { id: 'mbestimate', name: 'MBEstimate', href: '/members/mbestimate', section: 'Real Estate', blurb: 'Home value estimate by address', status: 'built', icon: 'home-search', keywords: ['avm', 'valuation', 'estimate'] },
  { id: 'open-house-flyers', name: 'Open House Flyers', href: '/members/open-house-flyers', section: 'Real Estate', blurb: 'Payment-scenario flyers for listings', status: 'reimagined', icon: 'file-image', keywords: ['flyer', 'listing'] },
  { id: 'seller-contribution', name: 'Seller Contribution', href: '/members/seller-contribution', section: 'Real Estate', blurb: 'Price cut vs seller credit', status: 'reimagined', icon: 'hand-coins', keywords: ['concession', 'credit', 'buydown'] },

  { id: 'payment', name: 'Payment Calculator', href: '/members/payment', section: 'Calculators', blurb: 'P&I and amortization schedule', status: 'built', icon: 'calculator', keywords: ['amortization', 'mortgage payment'] },
  { id: 'affordability', name: 'Affordability', href: '/members/affordability', section: 'Calculators', blurb: 'How much home an income buys', status: 'built', icon: 'wallet', keywords: ['dti', 'qualify', 'income'] },
  { id: 'buying-power', name: 'Buying Power', href: '/members/buying-power', section: 'Calculators', blurb: 'How rate moves change loan size', status: 'built', icon: 'zap' },
  { id: 'arm-vs-fixed', name: 'ARM vs Fixed', href: '/members/arm-vs-fixed', section: 'Calculators', blurb: 'Worst-case ARM vs fixed savings', status: 'built', icon: 'git-compare', keywords: ['adjustable', 'arm'] },
  { id: 'blended-rate', name: 'Blended Rate', href: '/members/blended-rate', section: 'Calculators', blurb: 'Weighted rate across debts', status: 'built', icon: 'blend' },
  { id: 'debt-consolidation', name: 'Debt Consolidation', href: '/members/debt-consolidation', section: 'Calculators', blurb: 'Roll debts into a refi or move-up', status: 'built', icon: 'layers', keywords: ['debts', 'cash out', 'move-up'] },
  { id: 'reinvestment', name: 'Reinvestment', href: '/members/reinvestment', section: 'Calculators', blurb: 'Grow savings with compound interest', status: 'built', icon: 'sprout', keywords: ['invest', 'compound'] },

  { id: 'social-studio', name: 'Social Studio', href: '/members/social-studio', section: 'Marketing', blurb: 'Video scripts written for you', status: 'built', icon: 'clapperboard', keywords: ['video', 'scripts', 'daily sharable social content'] },
  { id: 'newsletter', name: 'Newsletter', href: '/members/newsletter', section: 'Marketing', blurb: 'Weekly client newsletter', status: 'built', icon: 'mail', keywords: ['email campaigns'] },
  { id: 'social-share', name: 'Social Share', href: '/members/social-share', section: 'Marketing', blurb: 'Shareable graphics and posts', status: 'built', icon: 'share', keywords: ['social', 'posts'] },
  { id: 'prequalified-buyer-campaign', name: 'Prequalified Buyer Campaign', href: '/members/prequalified-buyer-campaign', section: 'Marketing', blurb: 'Report kit for prequalified buyers', status: 'built', icon: 'send', keywords: ['campaign', 'drip', 'email campaigns'] },
  { id: 'presentation-expressway', name: 'Presentation Expressway', href: '/members/presentation-expressway', section: 'Marketing', blurb: 'Barry Habib’s proven presentations', status: 'built', icon: 'monitor-play', keywords: ['slides', 'deck'] },

  { id: 'agent-feed', name: 'Agent Feed', href: '/members/agent-feed', section: 'Agent Feed', blurb: 'Content to share with agent partners', status: 'inferred', icon: 'rss', keywords: ['realtor', 'agents'] },
  { id: 'get-help', name: 'Get Help', href: 'https://support.mbshighway.com', section: 'Get Help', blurb: 'Help center (opens in a new tab)', status: 'external', icon: 'life-buoy', external: true },
];

export const SECTION_ORDER: Section[] = [
  'Home',
  'Market Analysis',
  'Clients',
  'Strike Rate',
  'Loan Comparison',
  'Real Estate',
  'Calculators',
  'Marketing',
  'Agent Feed',
  'Get Help',
];

/** Section hub pages (sections with more than one tool). */
export const SECTION_HUBS: Partial<Record<Section, string>> = {
  'Market Analysis': '/members/market-analysis',
  Clients: '/members/clients',
  'Loan Comparison': '/members/loan-comparison-tools',
  'Real Estate': '/members/real-estate',
  Calculators: '/members/calculators',
  Marketing: '/members/marketing',
};

export const SECTION_ICONS: Record<Section, string> = {
  Home: 'home',
  'Market Analysis': 'candlestick',
  Clients: 'users',
  'Strike Rate': 'target',
  'Loan Comparison': 'columns',
  'Real Estate': 'map-pin',
  Calculators: 'calculator',
  Marketing: 'megaphone',
  'Agent Feed': 'rss',
  'Get Help': 'life-buoy',
};

export function toolsIn(section: Section): Tool[] {
  return TOOLS.filter((t) => t.section === section);
}

export function findTool(id: string): Tool | undefined {
  return TOOLS.find((t) => t.id === id);
}

export function toolForPath(pathname: string): Tool | undefined {
  return TOOLS.find((t) => !t.external && (pathname === t.href || pathname.startsWith(t.href + '/')));
}

/** Searchable resources (articles, videos) for the global search, alongside tools. */
export const RESOURCES = [
  { name: 'Training Webinars', href: '/members/barrys-insights', kind: 'Resource' },
  { name: 'Become a CMA (becomecma.com)', href: 'https://becomecma.com', kind: 'External', external: true },
  { name: 'MBS Highway Articles', href: '/members/market-wrap', kind: 'Resource' },
  { name: 'Tutorial: Loan Comparison', href: '/members/loan-compare', kind: 'Tutorial' },
  { name: 'Guide: Strike Rate', href: '/members/strike-rate', kind: 'Guide' },
];
