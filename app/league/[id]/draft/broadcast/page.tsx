import { redirect } from 'next/navigation';

/**
 * The broadcast was built here first, as a route the app owner could open
 * beside the old board and judge. He judged it, and it is now the draft page
 * itself — the hero, the selection feed, run watch, the war room panel and
 * both best-available boards all live in `../page.tsx`, alongside everything
 * that page already did.
 *
 * The route stays only so a link he saved while it was a mockup still lands
 * somewhere real. There is nothing to render here; there is only one draft
 * page.
 */
export default function DraftBroadcastRedirect({ params }: { params: { id: string } }) {
  redirect(`/league/${params.id}/draft`);
}
