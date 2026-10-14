/** DEMO DATA — the LO's co-branding profile shown on every report. */
export interface CoBranding {
  name: string;
  nmls: string;
  company: string;
  cell: string;
  direct: string;
  email: string;
  address: string;
  title?: string;
}

export const DEFAULT_COBRANDING: CoBranding = {
  name: 'Jake Habib',
  nmls: '12345',
  company: 'MBS Highway',
  cell: '(732) 865-6551',
  direct: '(732) 526-7900',
  email: 'jake@mbshighway.com',
  address: '960 Holmdel Road, Holmdel, NJ 07733',
  title: 'Loan Officer',
};

/** Optional agent partner for co-branded reports (Buying Power / MBEstimate "Agent"). */
export const DEMO_AGENTS: CoBranding[] = [
  { name: 'Dana Whitfield', nmls: '—', company: 'Shoreline Realty Group', cell: '(555) 555-0188', direct: '(555) 555-0101', email: 'dana.whitfield@example.com', address: '12 Main St, Freehold, NJ 07728', title: 'REALTOR®' },
  { name: 'Marcus Lee', nmls: '—', company: 'Lone Star Homes', cell: '(555) 555-0177', direct: '(555) 555-0102', email: 'marcus.lee@example.com', address: '2100 Ross Ave, Dallas, TX 75201', title: 'Broker Associate' },
];
