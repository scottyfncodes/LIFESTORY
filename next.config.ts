import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents is intentionally off: the app is authenticated and per-user dynamic.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Database drivers load WASM / native sockets and must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite", "@neondatabase/serverless", "ws"],
  poweredByHeader: false,
  async headers() {
    // Conversation Weave uploads straight from the browser to private Vercel Blob
    // storage and plays recordings from short-lived presigned URLs. Those two
    // origins are only allowed when the feature is enabled.
    const weave = ["1", "true"].includes((process.env.WEAVE_ENABLED ?? "").toLowerCase());
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "media-src 'self' blob:" + (weave ? " https://*.private.blob.vercel-storage.com" : ""),
      "connect-src 'self'" + (weave ? " https://vercel.com/api/blob/" : ""),
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; ");
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Robots-Tag", value: "noindex" },
        ],
      },
      { source: "/", headers: [{ key: "X-Robots-Tag", value: "all" }] },
      { source: "/privacy", headers: [{ key: "X-Robots-Tag", value: "all" }] },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
