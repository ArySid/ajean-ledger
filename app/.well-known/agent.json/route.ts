// GET /.well-known/agent.json — free. A2A-style agent card (skills + x402 payment section).
import { NextResponse } from "next/server";
import { buildAgentCard } from "@/lib/discovery/agent-card";
import { baseUrlFromRequest } from "@/lib/discovery/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return NextResponse.json(buildAgentCard(baseUrlFromRequest(req)), {
    headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}
