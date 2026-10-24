import { NextRequest, NextResponse } from 'next/server';
import { TEMPLATE_NAMES, TemplateName, csvTemplate } from '@/lib/leagueCsv';

export const dynamic = 'force-dynamic';

/**
 * The CSV templates an author builds a league in.
 *
 * GENERATED FROM THE CODE, NEVER CHECKED IN AS FILES. The header rows come out
 * of lib/leagueCsv.ts's own column lists — the real position list, the real
 * attribute catalogue, the real 32 franchises — so a template cannot offer a
 * column the parser does not accept, and adding an attribute to
 * lib/ratings.ts puts it in the template on the next request. A static
 * teams.csv in the repo would be a copy to go stale, and a stale template is
 * the specific failure that makes a download worse than nothing: the author
 * fills in 1,700 rows against it and is refused.
 *
 * No ownership check and nothing metered: this is a few kilobytes of constants
 * with no league id in it and nothing to leak.
 */
export async function GET(_req: NextRequest, { params }: { params: { file: string } }) {
  const wanted = params.file as TemplateName;
  if (!TEMPLATE_NAMES.includes(wanted)) {
    return NextResponse.json(
      { error: `There is no template called "${params.file.slice(0, 40)}". The templates are ${TEMPLATE_NAMES.join(', ')}.` },
      { status: 404 },
    );
  }

  return new NextResponse(csvTemplate(wanted), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${wanted}"`,
      // Derived from constants that only change with a deploy, so a day is
      // safe — but no longer, or an author who downloads a template the day a
      // column is added gets yesterday's.
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
