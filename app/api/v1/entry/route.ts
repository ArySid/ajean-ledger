// POST /api/v1/entry — paid via x402 v2 (0.15 USDC — journal entry proposal). Price: lib/payments/pricing.ts.
import { paidRoute } from "@/lib/api/paid-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = paidRoute("entry");
