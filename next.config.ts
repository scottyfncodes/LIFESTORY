import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents is intentionally off: the app is authenticated and per-user dynamic.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Database drivers load WASM / native sockets and must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite", "@neondatabase/serverless", "ws"],
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
