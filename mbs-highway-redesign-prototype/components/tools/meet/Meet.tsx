'use client';

import { ArrowRight, CalendarClock, Copy, Film, Link2, Mic, MonitorUp, Video } from 'lucide-react';
import Link from 'next/link';
import { ToolIcon } from '@/components/icons';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, TextInput } from '@/components/ui';
import { DisplayOnly } from '@/components/tools/strike-rate/DisplayOnly';
import { useStore } from '@/lib/store';
import { findTool } from '@/lib/tools';

const PRESENT_TOOLS = ['markets', 'rerc', 'buy-vs-rent', 'loan-compare', 'cost-of-waiting', 'equity-gained'];

const TIPS = [
  { title: 'Send the link before the call', body: 'Your room link never changes — put it in the calendar invite so clients join with one click.' },
  { title: 'Lead with the market, then the client', body: 'Open Markets Overview for a 60-second rate story, then move to the client’s Real Estate Report Card.' },
  { title: 'Let the numbers talk', body: 'Share Buy vs Rent and Loan Comparison live; each result has an LO talk track you can follow (it’s hidden from the client view).' },
  { title: 'Record and follow up', body: 'Recordings land in folders by tool, so you can send a client the replay of their exact scenario.' },
];

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'my-room';
}

export function Meet() {
  const { cobranding, toast } = useStore();
  const link = `https://meet.mbshighway.com/${slug(cobranding.name)}`;
  const hostReason = 'Display only — no meeting is created in the prototype';

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Clients" title="Meet" subtitle="Host a Highway Meeting and walk clients through any MBS Highway tool live — video, screen share and recording in one link." />

      <Card padded={false} className="overflow-hidden">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="p-6 sm:p-8">
            <Badge tone="brand">
              <Video className="h-3 w-3" /> Highway Meeting
            </Badge>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">Your personal meeting room</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-600">
              Start an instant meeting from your room, present tools with your co-branding, and record the session to Recordings automatically.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <DisplayOnly reason={hostReason}>
                <Button size="lg" disabled icon={<Video className="h-5 w-5" />}>
                  Host
                </Button>
              </DisplayOnly>
              <Link href="/members/recordings" className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-5 text-[15px] font-medium text-slate-700 hover:bg-slate-50">
                <Film className="h-4 w-4" /> Recordings
              </Link>
            </div>
            <p className="mt-3 text-xs text-slate-500">Host is display-only in this prototype: no meeting room is created and nobody is invited.</p>

            <div className="mt-8">
              <label htmlFor="meet-link" className="text-[13px] font-medium text-slate-700">
                Meeting link <span className="font-normal text-slate-400">(preview)</span>
              </label>
              <div className="mt-1.5 flex gap-2">
                <div className="relative flex-1">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <TextInput id="meet-link" readOnly value={link} className="pl-9 text-slate-600" onFocus={(e) => e.target.select()} />
                </div>
                <Button
                  variant="secondary"
                  icon={<Copy className="h-4 w-4" />}
                  onClick={() => {
                    navigator.clipboard?.writeText(link).catch(() => {});
                    toast('Link copied — preview only, no room exists in the prototype', 'info');
                  }}
                >
                  Copy
                </Button>
              </div>
              <p className="mt-1 text-xs text-slate-500">Built from your co-branding name. Clients join from a browser — no download.</p>
            </div>
          </div>

          <div className="border-t border-slate-100 bg-slate-50 p-6 lg:border-l lg:border-t-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">What your client sees</div>
            <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
              <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
                <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
                <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
                <span className="ml-2 truncate text-[11px] text-slate-400">{link.replace('https://', '')}</span>
              </div>
              <div className="flex aspect-video flex-col items-center justify-center bg-gradient-to-br from-ink-800 to-ink-950 px-4 text-center text-white">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-lg font-semibold">
                  {cobranding.name
                    .split(' ')
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join('')}
                </span>
                <div className="mt-3 text-sm font-semibold">{cobranding.name}</div>
                <div className="text-xs text-white/60">
                  {cobranding.company} · NMLS# {cobranding.nmls}
                </div>
                <div className="mt-3 rounded-full bg-white/10 px-3 py-1 text-[11px] text-white/80">Waiting for {cobranding.name.split(' ')[0]} to start the meeting…</div>
              </div>
              <div className="flex justify-center gap-2 py-2.5">
                {[Mic, Video, MonitorUp].map((I, i) => (
                  <span key={i} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                    <I className="h-4 w-4" />
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Upcoming meetings" subtitle="Scheduled Highway Meetings" />
          <EmptyState
            title="No upcoming meetings"
            icon={<CalendarClock className="h-8 w-8" />}
            action={
              <Link href="/members/client-manager" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                Pick a client to follow up with <ArrowRight className="h-4 w-4" />
              </Link>
            }
          >
            Meetings you schedule from your calendar appear here with a one-click Host button.
          </EmptyState>
        </Card>

        <Card>
          <CardHeader title="Tips for a great meeting" />
          <ol className="space-y-4">
            {TIPS.map((t, i) => (
              <li key={t.title} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600"><span className="text-sm font-semibold">{i + 1}</span></span>
                <div>
                  <div className="text-sm font-semibold text-slate-900">{t.title}</div>
                  <p className="mt-0.5 text-sm text-slate-600">{t.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <Card>
        <CardHeader title="Present in a meeting" subtitle="The client-meeting flow, in order. Open a tool to rehearse before you host." />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PRESENT_TOOLS.map((id, i) => {
            const t = findTool(id);
            if (!t) return null;
            return (
              <Link key={id} href={t.href} className="group flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-3 transition-colors hover:border-brand-300 hover:bg-brand-50/50">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <ToolIcon name={t.icon} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900">
                    <span className="mr-1 text-slate-400">{i + 1}.</span>
                    {t.name}
                  </span>
                  <span className="block truncate text-xs text-slate-500">{t.blurb}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-brand-600" />
              </Link>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
