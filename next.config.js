/** @type {import('next').NextConfig} */

/**
 * ===========================================================================
 * RESPONSE HEADERS
 * ===========================================================================
 * Applied to every route, including the two API routes and the static assets,
 * because `source: '/(.*)'` is the only pattern that cannot be walked around
 * by asking for a path nobody listed.
 *
 * WHAT THE CONTENT SECURITY POLICY HERE DOES AND DOES NOT CLAIM.
 *
 * It is strict about ORIGINS and loose about INLINE. Every directive that
 * names a place — script, style, image, font, connect, frame, form target,
 * base URI — is `'self'` and nothing else, which is the whole of the attack it
 * can actually stop on this app: there is no third-party script, no analytics,
 * no embed, no CDN and no remote font anywhere in the tree, so an injected
 * `<script src="https://…">`, an exfiltrating `fetch`, a rewritten `<base>`
 * and a form reposted to somebody else's host are all refused outright.
 *
 * `'unsafe-inline'` stays on script-src and style-src, and that is a measured
 * decision rather than an oversight:
 *
 *   - STYLE. Five design-system components render a `<style>` tag through
 *     `dangerouslySetInnerHTML` (TrophyMoment, SeasonEndCard, CoachComments,
 *     WeekReportPanel, GameShapePath — keyframes that belong next to the thing
 *     they animate), and React sets element styles inline. A nonce cannot
 *     reach any of them.
 *   - SCRIPT. The App Router bootstraps every page with inline
 *     `self.__next_f.push(...)` payloads carrying the flight data. Next can
 *     nonce those, but only from middleware, and the nonce path in this exact
 *     version has its own unfixed advisory — GHSA-ffhc-5mcf-pf4q, "Next.js
 *     vulnerable to cross-site scripting in App Router applications using CSP
 *     nonces", which covers everything up to and including 14.2.35. Adding a
 *     nonce here would trade a known-loose directive for a known hole.
 *
 * So this is a real boundary against external origins and clickjacking, and it
 * is NOT a defence against injected inline script. The defence against that
 * remains React's own escaping plus the five audited `dangerouslySetInnerHTML`
 * sites, none of which interpolate user input. Tightening script-src is a
 * follow-up that wants a Next version where nonces are sound.
 *
 * DEVELOPMENT GETS A LOOSER POLICY, because `next dev` needs `eval` for its
 * refresh runtime and a websocket back to the dev server. Shipping the
 * production policy in both places would have meant a dev server that does not
 * hot-reload, which is how a CSP gets switched off entirely a week later.
 */
const isProd = process.env.NODE_ENV === 'production';

const csp = [
  "default-src 'self'",
  // See the long note above before loosening either of these two.
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  // No `data:` and no remote host. Verified rather than assumed: the whole
  // tree constructs no data: URI (no toDataURL, no btoa, no "data:image"
  // literal), the team marks and player avatars render as inline <svg>
  // elements rather than encoded images, and 21 rendered pages contain no
  // <img> tag at all. The tab icon and the share card are both routes on this
  // origin (/icon.svg, /opengraph-image).
  "img-src 'self'",
  // next/font/google SELF-HOSTS: every face is rewritten into
  // /_next/static/media/*.woff2 at build time, verified by grepping the built
  // CSS for an absolute url() and finding none. So no fonts.gstatic.com here.
  "font-src 'self'",
  // One fetch in the whole client tree (LeagueImportForm -> /api/league/import)
  // and it is same-origin. `ws:` is the dev server's refresh socket only.
  `connect-src 'self'${isProd ? '' : ' ws: wss:'}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Belt and braces with X-Frame-Options below: frame-ancestors is the one
  // modern browsers honour, X-Frame-Options is for anything that does not.
  "frame-ancestors 'none'",
  "manifest-src 'self'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  // Sniffing is how a league file download or a generated SVG becomes an HTML
  // document executing in this origin.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // Full URLs carry league and player ids. Same-origin keeps them inside the
  // app and sends only the origin to anywhere else.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Nothing in this game asks for a camera, a microphone or a location, so
  // nothing should be able to.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

/**
 * HSTS is PRODUCTION-ONLY and deliberately so. Sent on a local `next dev` over
 * http it is ignored, but sent once from any https origin it pins that origin
 * to https in the browser for two years — which on `localhost` with a
 * self-signed certificate is a development machine nobody can un-pin without
 * clearing site data. Two years, subdomains included, and no `preload`: the
 * preload list is a one-way door that needs the owner's decision, not a
 * config default.
 */
const hsts = { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' };

const nextConfig = {
  reactStrictMode: true,

  // Drops the `X-Powered-By: Next.js` response header. It advertises the
  // framework and version to anyone scanning, and nothing needs it.
  poweredByHeader: false,

  // Vercel serves this app entirely from serverless functions (every page is
  // dynamic — see docs/deployment.md), so there is nothing to gain from
  // trailing-slash or image-optimisation configuration here yet.

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: isProd ? [...securityHeaders, hsts] : securityHeaders,
      },
    ];
  },
};
module.exports = nextConfig;
