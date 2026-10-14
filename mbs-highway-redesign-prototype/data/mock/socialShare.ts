/**
 * DEMO DATA — shareable social graphics. Original copy; stats are illustrative demo
 * figures (labelled "Demo Data" in the UI), not sourced market statistics.
 */

export const SHARE_CATEGORIES = [
  'Benefits of Homeownership',
  'Buy vs Rent',
  'First-Time Buyers',
  'Refinance',
  'Market Update',
  'Credit',
  'Home Tips',
  'Down Payment',
] as const;
export type ShareCategory = (typeof SHARE_CATEGORIES)[number];

export type CardTheme = 'purple' | 'navy' | 'emerald' | 'sunset' | 'sky' | 'gold';

export const CARD_THEMES: Record<CardTheme, { from: string; to: string; accent: string; text: string }> = {
  purple: { from: '#3e1a8f', to: '#6a2ff2', accent: '#d9d1ff', text: '#ffffff' },
  navy: { from: '#0b1020', to: '#27325c', accent: '#1baf7a', text: '#ffffff' },
  emerald: { from: '#065f46', to: '#0f9d6b', accent: '#d1fae5', text: '#ffffff' },
  sunset: { from: '#c2410c', to: '#e87ba4', accent: '#fff3e0', text: '#ffffff' },
  sky: { from: '#1e40af', to: '#2a78d6', accent: '#dbeafe', text: '#ffffff' },
  gold: { from: '#fffbeb', to: '#fde68a', accent: '#b45309', text: '#1f2937' },
};

export interface ShareCard {
  id: string;
  category: ShareCategory;
  headline: string;
  stat: string;
  statLabel: string;
  caption: string;
  hashtags: string[];
  published: string;
  theme: CardTheme;
}

export const SHARE_CARDS: ShareCard[] = [
  { id: 'sc-1', category: 'Benefits of Homeownership', headline: 'Owners build wealth while they live in it', stat: '40×', statLabel: 'typical owner vs. renter net worth (demo figure)', caption: 'Homeownership is one of the few ways to build wealth while you live your life. Every payment chips away at your balance, and appreciation does the rest. Curious how it could work for you? Let’s talk.', hashtags: ['homeownership', 'wealth', 'realestate'], published: '2026-10-09', theme: 'purple' },
  { id: 'sc-2', category: 'Benefits of Homeownership', headline: 'Your fixed payment doesn’t care about inflation', stat: '30 yrs', statLabel: 'of the same principal & interest payment', caption: 'Rent goes up. Groceries go up. A fixed-rate principal and interest payment stays put for 30 years. That’s stability you can plan a life around.', hashtags: ['fixedrate', 'inflation', 'homeowner'], published: '2026-10-02', theme: 'navy' },
  { id: 'sc-3', category: 'Benefits of Homeownership', headline: 'Equity is a savings account with a front door', stat: '$52,883', statLabel: 'principal paid down in 9 years on a $400K loan at 6.5%', caption: 'On a $400K loan at 6.5%, you pay down over $52K of principal in the first nine years — before any appreciation. That’s forced savings working for you.', hashtags: ['equity', 'mortgage', 'savings'], published: '2026-09-25', theme: 'emerald' },
  { id: 'sc-4', category: 'Buy vs Rent', headline: 'Renting pays your landlord’s mortgage', stat: '$385K', statLabel: 'rent paid over 10 years at $2,800/mo + 3%/yr (demo)', caption: 'At $2,800 a month with 3% yearly increases, ten years of rent adds up to roughly $385K. What if a good part of that went toward a home of your own?', hashtags: ['buyvsrent', 'rent', 'homebuying'], published: '2026-10-07', theme: 'sunset' },
  { id: 'sc-5', category: 'Buy vs Rent', headline: 'Same monthly budget, very different outcome', stat: '2 paths', statLabel: 'one builds equity, one builds receipts', caption: 'Two people spend about the same each month on housing. One owns, one rents. Ten years later, only one has equity. Want me to run your buy vs. rent comparison?', hashtags: ['buyvsrent', 'equity'], published: '2026-09-18', theme: 'sky' },
  { id: 'sc-6', category: 'Buy vs Rent', headline: 'Rents rose again this year', stat: '+3%', statLabel: 'assumed annual rent increase (demo)', caption: 'Even modest rent increases compound. A fixed mortgage payment locks in your biggest monthly cost. Let’s see what owning would look like for you.', hashtags: ['rent', 'housingcosts'], published: '2026-08-28', theme: 'gold' },
  { id: 'sc-7', category: 'First-Time Buyers', headline: 'You may not need 20% down', stat: '3%', statLabel: 'minimum down on some conventional programs', caption: 'One of the biggest myths in real estate: you need 20% down. Many first-time buyers put down as little as 3–3.5%. Let’s find the program that fits you.', hashtags: ['firsttimehomebuyer', 'downpayment'], published: '2026-10-08', theme: 'purple' },
  { id: 'sc-8', category: 'First-Time Buyers', headline: 'Pre-approved beats pre-qualified', stat: '1 step', statLabel: 'that makes your offer stand out', caption: 'Sellers take pre-approved buyers more seriously. It means your income, assets and credit have actually been reviewed. Ready to get yours?', hashtags: ['preapproval', 'homebuying'], published: '2026-09-29', theme: 'navy' },
  { id: 'sc-9', category: 'First-Time Buyers', headline: 'Know your whole payment', stat: 'PITI', statLabel: 'principal · interest · taxes · insurance', caption: 'Your mortgage payment is more than principal and interest. Taxes and insurance matter too. Send me a listing you love and I’ll break down the full payment.', hashtags: ['firsttimebuyer', 'mortgagetips'], published: '2026-09-10', theme: 'sky' },
  { id: 'sc-10', category: 'Refinance', headline: 'Find your refinance break-even', stat: '21 mo', statLabel: 'example break-even on a 7.5% → 6.5% refi', caption: 'Refinancing makes sense when you’ll stay longer than your break-even. In one example, dropping from 7.5% to 6.5% saves about $269/month. Let’s run yours.', hashtags: ['refinance', 'mortgagerates'], published: '2026-10-06', theme: 'emerald' },
  { id: 'sc-11', category: 'Refinance', headline: 'Waiting for the perfect rate has a cost', stat: '$2,686', statLabel: 'cost of waiting 10 months in one refi example', caption: 'Holding out for a slightly lower rate can cost more than it saves. In one example, waiting 10 months cost about $2,686 in missed savings.', hashtags: ['refi', 'costofwaiting'], published: '2026-09-22', theme: 'sunset' },
  { id: 'sc-12', category: 'Refinance', headline: 'Consolidate high-interest debt', stat: '22%', statLabel: 'typical credit card APR vs. mortgage rates', caption: 'Carrying card balances at 20%+? For some homeowners, rolling that debt into a mortgage cuts total monthly payments significantly. Let’s see if it fits.', hashtags: ['debtconsolidation', 'cashout'], published: '2026-09-04', theme: 'purple' },
  { id: 'sc-13', category: 'Market Update', headline: 'Home prices hit another high', stat: '+4.5%', statLabel: 'year-over-year national price change (demo)', caption: 'Prices continue to climb as inventory stays tight. If you already own, your equity just grew. If you’re buying, a plan matters more than ever.', hashtags: ['marketupdate', 'homeprices'], published: '2026-10-09', theme: 'navy' },
  { id: 'sc-14', category: 'Market Update', headline: 'Inventory is slowly improving', stat: '+12%', statLabel: 'more active listings vs. last year (demo)', caption: 'More homes on the market means more choice and a bit more negotiating room for buyers. It could be a good time to start looking.', hashtags: ['inventory', 'realestate'], published: '2026-09-26', theme: 'sky' },
  { id: 'sc-15', category: 'Market Update', headline: 'What the Fed means for mortgage rates', stat: 'MBS', statLabel: 'mortgage rates follow mortgage bonds, not the Fed', caption: 'The Fed doesn’t set mortgage rates — mortgage-backed securities do. That’s why rates sometimes move opposite to Fed headlines. I watch them daily for you.', hashtags: ['fed', 'mortgagerates'], published: '2026-09-17', theme: 'gold' },
  { id: 'sc-16', category: 'Credit', headline: 'Three moves that can lift your score', stat: '3', statLabel: 'pay down cards · no new debt · pay on time', caption: 'Before you apply: pay down card balances, avoid new accounts and keep every payment on time. A few points can mean a better rate.', hashtags: ['credit', 'creditscore'], published: '2026-10-01', theme: 'emerald' },
  { id: 'sc-17', category: 'Credit', headline: 'Utilization matters more than you think', stat: '<30%', statLabel: 'card utilization target', caption: 'Keeping card balances below 30% of your limits — lower is better — is one of the fastest ways to improve your score before a mortgage.', hashtags: ['credittips', 'homebuying'], published: '2026-09-08', theme: 'purple' },
  { id: 'sc-18', category: 'Credit', headline: 'Don’t finance the furniture yet', stat: 'Wait', statLabel: 'until after closing for new credit', caption: 'New credit during your loan can delay or derail closing. Celebrate with new furniture — after you get the keys.', hashtags: ['mortgagetips', 'credit'], published: '2026-08-20', theme: 'sunset' },
  { id: 'sc-19', category: 'Home Tips', headline: 'Fall maintenance checklist', stat: '5', statLabel: 'quick tasks to protect your home', caption: 'Clean the gutters, service the furnace, seal drafts, test detectors, and disconnect hoses. Save this for the weekend!', hashtags: ['hometips', 'fallmaintenance'], published: '2026-10-05', theme: 'gold' },
  { id: 'sc-20', category: 'Home Tips', headline: 'Budget 1% a year for upkeep', stat: '1%', statLabel: 'of home value per year for maintenance', caption: 'A simple rule of thumb: set aside about 1% of your home’s value each year for maintenance. Future you will be grateful.', hashtags: ['homeowner', 'budgeting'], published: '2026-09-15', theme: 'emerald' },
  { id: 'sc-21', category: 'Home Tips', headline: 'Shop your insurance every renewal', stat: '$$$', statLabel: 'premiums vary widely between carriers', caption: 'Homeowners insurance premiums can vary a lot. A quick comparison at renewal can save real money each year.', hashtags: ['insurance', 'hometips'], published: '2026-08-25', theme: 'navy' },
  { id: 'sc-22', category: 'Down Payment', headline: 'Down payment help is out there', stat: '2,000+', statLabel: 'assistance programs nationwide (demo figure)', caption: 'There are many down payment assistance programs — grants, forgivable loans and more. Many buyers never ask. Let’s see what you qualify for.', hashtags: ['downpaymentassistance', 'firsttimebuyer'], published: '2026-10-03', theme: 'sky' },
  { id: 'sc-23', category: 'Down Payment', headline: 'Gift funds can help', stat: 'Gift', statLabel: 'family gifts can count toward down payment', caption: 'Many loan programs allow gift funds from family toward your down payment. There’s paperwork involved — I’ll walk you through it.', hashtags: ['downpayment', 'homebuying'], published: '2026-09-12', theme: 'purple' },
  { id: 'sc-24', category: 'Down Payment', headline: '5% down on a $500K home', stat: '$25,000', statLabel: 'down payment at 5% on $500,000', caption: 'At 5% down, a $500K home needs $25,000 down — not $100,000. Mortgage insurance applies, but you could be in years sooner.', hashtags: ['downpayment', 'mortgage'], published: '2026-08-18', theme: 'emerald' },
];
