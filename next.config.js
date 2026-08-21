/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Drops the `X-Powered-By: Next.js` response header. It advertises the
  // framework and version to anyone scanning, and nothing needs it.
  poweredByHeader: false,

  // Vercel serves this app entirely from serverless functions (every page is
  // dynamic — see docs/deployment.md), so there is nothing to gain from
  // trailing-slash or image-optimisation configuration here yet.
};
module.exports = nextConfig;
