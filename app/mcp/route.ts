// /mcp — remote MCP server (Streamable HTTP, stateless, JSON responses). Tools: check_invoice, create_entry,
// audit_entries (paid via the x402 MCP transport, same prices/requirements as the HTTP API) + get_catalog, get_receipt (free).
import { NextResponse } from "next/server";
import { errorBody } from "@/lib/api/errors";
import { checkRateLimit, clientKey } from "@/lib/api/rate-limit";
import { handleMcpRequest } from "@/lib/discovery/mcp-remote";
import { baseUrlFromRequest, discoveryLinks } from "@/lib/discovery/meta";
import { ALL_TOOL_NAMES } from "@/lib/discovery/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const wait = checkRateLimit(clientKey(req.headers));
  if (wait !== null) {
    return NextResponse.json(errorBody("RATE_LIMITED", `Too many requests. Retry in ${wait}s.`, { retry_after_seconds: wait }), {
      status: 429,
      headers: { "Retry-After": String(wait) },
    });
  }
  return handleMcpRequest(req, baseUrlFromRequest(req));
}

function info(req: Request) {
  const links = discoveryLinks(baseUrlFromRequest(req));
  return NextResponse.json(
    {
      ...errorBody("METHOD_NOT_ALLOWED", "This is a stateless MCP Streamable HTTP endpoint: send JSON-RPC with POST (Accept: application/json, text/event-stream). No SSE stream, no sessions."),
      mcp: { url: links.mcp, transport: "streamable-http", stateless: true, tools: ALL_TOOL_NAMES, payment: "x402 MCP transport (_meta['x402/payment'])" },
      discovery: links,
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export async function GET(req: Request) {
  return info(req);
}

export async function DELETE(req: Request) {
  return info(req);
}
