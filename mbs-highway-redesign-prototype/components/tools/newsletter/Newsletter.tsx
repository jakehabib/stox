'use client';

import clsx from 'clsx';
import { CalendarDays, Copy, Eye, Lightbulb, Mail, Share2, Sparkles, TrendingUp, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, DemoBadge, EmptyState, Modal, PageHeader, Select } from '@/components/ui';
import { copyText, initials } from '@/components/tools/social-studio/shared';
import type { CoBranding } from '@/data/mock/cobranding';
import { CURRENT_ISSUE_ID, NEWSLETTER_ISSUES, type NewsletterIssue } from '@/data/mock/newsletter';
import { availableMonths, inMonth, monthLabel } from '@/lib/calculations/marketingFilters';
import { date } from '@/lib/format';
import { useStore } from '@/lib/store';

const fmtWeek = (iso: string) => `Week of ${date(iso + 'T12:00:00Z', 'long').replace(/^\w+, /, '')}`;

/** Plain-text version for "Copy all" (paste into any email client). */
export function newsletterText(i: NewsletterIssue, c: CoBranding): string {
  const L: string[] = [];
  L.push(`${c.name} · ${c.company} — Weekly Market Newsletter`, fmtWeek(i.date), '', i.title.toUpperCase(), '', i.preheader, '');
  L.push(`■ ${i.lead.heading.toUpperCase()}`, ...i.lead.paragraphs.flatMap((p) => [p, '']));
  L.push('■ QUICK MARKET HITS', ...i.quickHits.map((h) => `• ${h.title} — ${h.body}`), '');
  L.push(`■ FAMILY HACK: ${i.familyHack.title}`, i.familyHack.body, ...(i.familyHack.steps ?? []).map((s, n) => `  ${n + 1}. ${s}`), '');
  L.push('■ WHAT TO WATCH AHEAD', ...i.whatToWatch.map((w) => `• ${w.day} — ${w.event}: ${w.why}`), '');
  L.push('—', `${c.name}${c.title ? `, ${c.title}` : ''} | NMLS# ${c.nmls} | ${c.company}`, `Cell ${c.cell} | Direct ${c.direct} | ${c.email}`, c.address);
  return L.join('\n');
}

export function Newsletter() {
  const { cobranding, toast } = useStore();
  const [issueId, setIssueId] = useState(CURRENT_ISSUE_ID);
  const [month, setMonth] = useState<string>('all');
  const [preview, setPreview] = useState(false);
  const [miles, setMiles] = useState(false);
  const months = useMemo(() => availableMonths(NEWSLETTER_ISSUES.map((i) => i.date)), []);
  const issue = NEWSLETTER_ISSUES.find((i) => i.id === issueId) ?? NEWSLETTER_ISSUES[0];
  const recent = NEWSLETTER_ISSUES.filter((i) => inMonth(i.date, month));

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const id = sp.get('issue');
    if (id && NEWSLETTER_ISSUES.some((i) => i.id === id)) setIssueId(id);
    if (sp.get('preview') === '1') setPreview(true);
  }, []);

  const pick = (id: string) => {
    setIssueId(id);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('issue', id);
      url.searchParams.delete('preview');
      window.history.replaceState(window.history.state, '', url.toString());
    } catch {
      /* ignore */
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const shareLink = () => `${window.location.origin}/members/newsletter?issue=${issue.id}&preview=1`;

  return (
    <div>
      <PageHeader
        eyebrow="Marketing"
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            Newsletter <DemoBadge />
          </span>
        }
        subtitle="Your weekly co-branded client newsletter — market news in plain English, ready to send."
        actions={
          <>
            <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={async () => toast((await copyText(newsletterText(issue, cobranding))) ? 'Newsletter copied — paste it into your email' : 'Copy failed', 'info')}>
              Copy all
            </Button>
            <Button variant="secondary" icon={<Eye className="h-4 w-4" />} onClick={() => setPreview(true)}>
              Preview link
            </Button>
            <Button
              variant="secondary"
              icon={<Share2 className="h-4 w-4" />}
              onClick={async () => {
                await copyText(shareLink());
                toast('Share link copied — Prototype — nothing was sent', 'info');
              }}
            >
              Share
            </Button>
            <Button icon={<Sparkles className="h-4 w-4" />} onClick={() => setMiles(true)}>
              Ask Miles
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card padded={false} className="overflow-hidden">
          <IssueView issue={issue} cobranding={cobranding} current={issue.id === CURRENT_ISSUE_ID} />
        </Card>
        <aside className="space-y-4 lg:sticky lg:top-[7.5rem] lg:h-fit">
          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-[15px] font-semibold text-slate-900">Recent Newsletters</h3>
              <span className="text-xs text-slate-400">{recent.length}</span>
            </div>
            <Select
              ariaLabel="Filter by month"
              value={month}
              onChange={setMonth}
              options={[{ value: 'all', label: 'All months' }, ...months.map((m) => ({ value: m, label: monthLabel(m) }))]}
              className="mb-3"
            />
            {recent.length === 0 ? (
              <EmptyState title="No issues this month" />
            ) : (
              <ul className="-mx-2 space-y-0.5">
                {recent.map((i) => (
                  <li key={i.id}>
                    <button type="button" onClick={() => pick(i.id)} aria-current={i.id === issue.id} className={clsx('w-full rounded-lg px-2 py-2 text-left transition-colors', i.id === issue.id ? 'bg-brand-50' : 'hover:bg-slate-50')}>
                      <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
                        <CalendarDays className="h-3.5 w-3.5" />
                        {date(i.date + 'T12:00:00Z')}
                        {i.id === CURRENT_ISSUE_ID && <Badge tone="brand">This week</Badge>}
                      </div>
                      <div className={clsx('mt-0.5 text-sm font-medium leading-snug', i.id === issue.id ? 'text-brand-800' : 'text-slate-800')}>{i.title}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="bg-gradient-to-br from-white to-brand-50/50">
            <div className="flex items-start gap-3">
              <Mail className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
              <div className="text-sm text-slate-600">
                <div className="font-semibold text-slate-900">How LOs use this</div>
                Copy all and paste into your CRM or email, or share the preview link on social. Your co-branding is applied automatically.
              </div>
            </div>
          </Card>
        </aside>
      </div>

      <Modal
        open={preview}
        onClose={() => setPreview(false)}
        title="Client preview"
        description="What your clients see when they open the link."
        size="xl"
        footer={
          <>
            <Button
              variant="secondary"
              icon={<Copy className="h-4 w-4" />}
              onClick={async () => {
                await copyText(shareLink());
                toast('Preview link copied — Prototype — nothing was sent', 'info');
              }}
            >
              Copy preview link
            </Button>
            <Button onClick={() => setPreview(false)}>Close</Button>
          </>
        }
      >
        <div className="-mx-5 -my-4 bg-slate-100 px-2 py-6 sm:px-6">
          <div className="mx-auto max-w-[640px] overflow-hidden rounded-lg bg-white shadow-card">
            <IssueView issue={issue} cobranding={cobranding} clientFacing />
          </div>
        </div>
      </Modal>
      <Modal open={miles} onClose={() => setMiles(false)} title="Ask Miles" size="sm" footer={<Button onClick={() => setMiles(false)}>Got it</Button>}>
        <div className="flex items-start gap-3 text-sm text-slate-600">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
          <p>Ask Miles — coming soon in prototype. Miles will answer client questions about this week’s newsletter.</p>
        </div>
      </Modal>
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h3 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-700">
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-50 text-brand-600">{icon}</span>
      {children}
    </h3>
  );
}

/** The rendered issue. `clientFacing` hides LO-only chrome (it's the preview). */
export function IssueView({ issue, cobranding: c, current, clientFacing }: { issue: NewsletterIssue; cobranding: CoBranding; current?: boolean; clientFacing?: boolean }) {
  return (
    <article>
      {/* co-branded header */}
      <header className="bg-gradient-to-br from-ink-900 via-ink-800 to-brand-800 px-6 py-6 text-white sm:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-bold">{initials(c.name)}</div>
          <div className="min-w-0">
            <div className="truncate font-semibold">{c.name}</div>
            <div className="truncate text-xs text-white/70">
              {c.company} · NMLS# {c.nmls}
            </div>
          </div>
          <div className="ml-auto hidden text-right text-xs text-white/70 sm:block">
            Weekly Market Newsletter
            <br />
            {fmtWeek(issue.date)}
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {current && !clientFacing && <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">This week</span>}
          <span className="text-xs text-white/70 sm:hidden">{fmtWeek(issue.date)}</span>
        </div>
        <h2 className="mt-1 text-2xl font-bold leading-tight tracking-tight sm:text-[28px]">{issue.title}</h2>
        <p className="mt-2 max-w-2xl text-sm text-white/80">{issue.preheader}</p>
      </header>

      <div className="space-y-8 px-6 py-7 sm:px-8">
        <section>
          <SectionTitle icon={<TrendingUp className="h-3.5 w-3.5" />}>{issue.lead.heading}</SectionTitle>
          <div className="space-y-3 text-[15px] leading-relaxed text-slate-700">
            {issue.lead.paragraphs.map((p, n) => (
              <p key={n}>{p}</p>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle icon={<Zap className="h-3.5 w-3.5" />}>Quick Market Hits</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {issue.quickHits.map((h) => (
              <div key={h.title} className="rounded-xl border border-slate-200 p-4">
                <div className="text-sm font-semibold text-slate-900">{h.title}</div>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{h.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl bg-amber-50/70 p-5">
          <SectionTitle icon={<Lightbulb className="h-3.5 w-3.5" />}>Family Hack</SectionTitle>
          <div className="font-semibold text-slate-900">{issue.familyHack.title}</div>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">{issue.familyHack.body}</p>
          {issue.familyHack.steps && (
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-700">
              {issue.familyHack.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )}
        </section>

        <section>
          <SectionTitle icon={<CalendarDays className="h-3.5 w-3.5" />}>What to Watch Ahead</SectionTitle>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {issue.whatToWatch.map((w) => (
              <li key={w.event} className="flex gap-4 px-4 py-3">
                <span className="w-10 shrink-0 text-sm font-bold text-brand-700">{w.day}</span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">{w.event}</div>
                  <div className="text-sm text-slate-600">{w.why}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* co-branded footer */}
      <footer className="border-t border-slate-200 bg-slate-50 px-6 py-5 text-xs text-slate-600 sm:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">
              {c.name}
              {c.title ? `, ${c.title}` : ''}
            </div>
            <div>
              {c.company} · NMLS# {c.nmls}
            </div>
            <div>{c.address}</div>
          </div>
          <div className="sm:text-right">
            <div>Cell {c.cell}</div>
            <div>Direct {c.direct}</div>
            <div>{c.email}</div>
          </div>
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
          For informational purposes only; not a commitment to lend. Market commentary reflects demo content in this prototype.{clientFacing ? ' You are receiving this because you asked to stay informed — unsubscribe anytime.' : ''}
        </p>
      </footer>
    </article>
  );
}
