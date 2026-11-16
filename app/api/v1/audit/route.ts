// POST /api/v1/audit — paid via x402 v2 (1.00 USDC — batch audit (1..50 items)). Price: lib/payments/pricing.ts.
import { paidRoute } from "@/lib/api/paid-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = paidRoute("audit");
