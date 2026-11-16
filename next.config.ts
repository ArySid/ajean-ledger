import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Vercel usage minimal: no image optimisation needed.
  images: { unoptimized: true },
  // Fixtures and replays are read from disk at runtime by API routes.
  outputFileTracingIncludes: { "/**": ["./fixtures/**/*", "./demo/replays/**/*"] },
};

export default nextConfig;
