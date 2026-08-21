import type { MetadataRoute } from 'next';

/** Only the front door is public; everything else is somebody's save. */
export default function sitemap(): MetadataRoute.Sitemap {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://dynastygm.gg';
  return [{ url: site, changeFrequency: 'weekly', priority: 1 }];
}
