import { NextRequest, NextResponse } from 'next/server';
import { createLeague } from '@/lib/gen/league';
import { DEFAULT_SETTINGS, LeagueSettings } from '@/lib/settings';
import { TEAM_SEEDS } from '@/lib/gen/names';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const userTeamAbbr: string = body.userTeamAbbr || TEAM_SEEDS[0].abbr;
    const leagueName: string = body.name || 'My League';
    const settings: Partial<LeagueSettings> = { ...DEFAULT_SETTINGS, ...(body.settings ?? {}) };

    const leagueId = await createLeague({ name: leagueName, userTeamAbbr, settings });
    return NextResponse.json({ leagueId });
  } catch (err: any) {
    console.error('League creation failed', err);
    return NextResponse.json({ error: err?.message ?? 'League creation failed' }, { status: 500 });
  }
}
