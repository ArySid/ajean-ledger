// POST /api/v1/invoice/check — paid via x402 v2 (0.05 USDC — e-invoice compliance check). Price: lib/payments/pricing.ts.
import { paidRoute } from "@/lib/api/paid-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = paidRoute("invoice_check");
