// GET /openapi.json — free. OpenAPI 3.1 spec generated from pricing.ts + lib/discovery/schemas.ts.
import { NextResponse } from "next/server";
import { baseUrlFromRequest } from "@/lib/discovery/meta";
import { buildOpenApi } from "@/lib/discovery/openapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return NextResponse.json(buildOpenApi(baseUrlFromRequest(req)), {
    headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}
