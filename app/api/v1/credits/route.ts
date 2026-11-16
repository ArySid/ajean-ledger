// POST /api/v1/credits — paid via x402 v2: buys a prepaid credit pack (body {"pack":"starter"|"pro"}).
// Returns a bearer credit token for the X-Credit-Token header. Packs: lib/payments/pricing.ts (ADR-025).
import { purchaseCredits } from "@/lib/api/credits-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = purchaseCredits;
