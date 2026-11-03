import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Lets several local processes (dev servers, builds) coexist: NEXT_DIST_DIR=.next-ui pnpm dev
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Server code reads these from disk at runtime; make sure they ship with the functions.
  outputFileTracingIncludes: {
    "/**": ["./assets/fonts/**", "./content/sealed/**", "./content/sample/pack.json"],
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
