import type { MetadataRoute } from 'next';

/**
 * /design-system is a developer route with no nav link — it renders every
 * component against fake data and should not be what a search engine finds
 * when it looks for this game. /api and /league are excluded for the same
 * reason plus a stronger one: a league URL is a save file, and the ownership
 * cookie is the only thing protecting it.
 */
export default function robots(): MetadataRoute.Robots {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://dynastygm.gg';
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/design-system', '/api/', '/league/'] },
    sitemap: `${site}/sitemap.xml`,
  };
}
