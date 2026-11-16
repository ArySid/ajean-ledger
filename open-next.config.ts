// OpenNext adapter config for Cloudflare Workers (docs/HOSTING.md).
// No incremental cache binding (R2/KV) is needed: every API route is dynamic and the
// few static pages (/, /office) are served from the prerendered assets.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  // Keep cold starts cheap on the free plan (10 ms CPU / request): load route code lazily.
  routePreloadingBehavior: "none",
});
