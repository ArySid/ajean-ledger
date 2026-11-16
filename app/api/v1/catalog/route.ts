// GET /api/v1/catalog — free. Machine-readable service + pricing manifest (built from lib/payments/pricing.ts).
import { NextResponse } from "next/server";
import { buildCatalog } from "@/lib/discovery/catalog";
import { baseUrlFromRequest } from "@/lib/discovery/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return NextResponse.json(buildCatalog(baseUrlFromRequest(req)), {
    headers: { "Cache-Control": "public, max-age=60", "Access-Control-Allow-Origin": "*" },
  });
}
