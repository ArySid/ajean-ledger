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

const USAGE = "This is a stateless MCP Streamable HTTP endpoint: send JSON-RPC with POST (Accept: application/json, text/event-stream). No SSE stream, no sessions.";

function mcpInfo(req: Request) {
  const links = discoveryLinks(baseUrlFromRequest(req));
  return {
    mcp: { url: links.mcp, transport: "streamable-http", stateless: true, tools: ALL_TOOL_NAMES, payment: "x402 MCP transport (_meta['x402/payment'])" },
    discovery: links,
  };
}

function info(req: Request) {
  return NextResponse.json({ ...errorBody("METHOD_NOT_ALLOWED", USAGE), ...mcpInfo(req) }, { status: 405, headers: { Allow: "POST" } });
}

/**
 * An MCP client opening an SSE stream (Accept: text/event-stream) gets the 405 the Streamable HTTP spec
 * requires from a server without one. Anyone else (a browser, a juror, an agent reading the landing's
 * link) gets 200 and a small JSON document explaining how to use the endpoint (Phase 7 review m7).
 */
export async function GET(req: Request) {
  if ((req.headers.get("accept") ?? "").includes("text/event-stream")) return info(req);
  const m = mcpInfo(req);
  return NextResponse.json(
    {
      name: "ajean-ledger",
      description: "Remote MCP server of Ajean Ledger: French e-invoicing checks, journal entries and audits for AI agents, paid per call in USDC over x402 (TESTNET on Base Sepolia in this PoC).",
      usage: USAGE,
      example: {
        method: "POST",
        url: m.mcp.url,
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      },
      ...m,
      docs: { llms_txt: m.discovery.llms_txt, readme_section: "README.md, MCP section" },
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}

export async function DELETE(req: Request) {
  return info(req);
}
