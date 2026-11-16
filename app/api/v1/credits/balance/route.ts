// GET /api/v1/credits/balance — free. Balance and expiry of the credit token sent in X-Credit-Token.
import { creditBalance } from "@/lib/api/credits-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = creditBalance;
