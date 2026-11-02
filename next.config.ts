import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next's built-in gzip of streamed RSC responses caused Chromium to abort some
  // client-side navigations (e.g. /retailer/catalogue?q=… -> /retailer/catalogue
  // froze the router). Compression belongs in the reverse proxy / CDN in front of
  // the app (gzip or brotli), which is also faster. See README "Deployment notes".
  compress: false,
};

export default nextConfig;
