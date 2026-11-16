// GET /api/v1/receipts/{id} — free. Payment receipt + result of a past paid call (id = request_id).
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, errorResponse, toApiError } from "@/lib/api/errors";
import { isRequestId } from "@/lib/api/request-id";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isRequestId(id)) throw new ApiError("INVALID_RECEIPT_ID", "Receipt id must be a request_id like req_01J...");
    const rec = await getStore().getReceipt(id);
    if (!rec) throw new ApiError("NOT_FOUND", `No receipt for ${id} (receipts may expire on in-memory deployments).`);
    return NextResponse.json(
      {
        request_id: rec.request_id,
        endpoint: rec.endpoint,
        created_at: rec.created_at,
        idempotency_key_used: rec.idempotency_key !== null,
        receipt: rec.receipt,
        result: rec.result,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return errorResponse(toApiError(e));
  }
}
