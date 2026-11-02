import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next's built-in gzip of streamed RSC responses caused Chromium to abort some
  // client-side navigations (e.g. /retailer/catalogue?q=… -> /retailer/catalogue
  // froze the router). Compression belongs in the reverse proxy / CDN in front of
  // the app (gzip or brotli), which is also faster. See README "Deployment notes".
  compress: false,
  poweredByHeader: false,
  async headers() {
    // No CSP yet: Next's inline bootstrap scripts need nonces; see README "Security notes".
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
