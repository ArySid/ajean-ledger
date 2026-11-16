import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No image optimisation needed (also keeps the Cloudflare Worker bundle small).
  images: { unoptimized: true },
  // Fixtures and replays are read from disk at runtime by API routes.
  outputFileTracingIncludes: { "/**": ["./fixtures/**/*", "./demo/replays/**/*"] },
};

// Opt-in: expose Cloudflare bindings (KV, vars) to `next dev` (CF_DEV=1 npm run dev).
if (process.env.CF_DEV === "1") {
  void import("@opennextjs/cloudflare").then((m) => m.initOpenNextCloudflareForDev());
}

export default nextConfig;
