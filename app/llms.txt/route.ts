// GET /llms.txt — free. Markdown discovery file for LLM agents (llmstxt.org). Errors section = docs_url target.
import { buildLlmsTxt } from "@/lib/discovery/llms";
import { baseUrlFromRequest } from "@/lib/discovery/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return new Response(buildLlmsTxt(baseUrlFromRequest(req)), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
