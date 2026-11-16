/**
 * Prepaid credit packs (ADR-025).
 *
 * POST /api/v1/credits  body {"pack": "starter" | "pro"}  — paid with ONE x402 payment (USDC or EURC).
 *   Pipeline = the paid routes' one: rate limit → body → idempotent replay → withX402 (per pack) →
 *   settlement → token issued AFTER settlement (never for an unsettled payment).
 *   200 → { request_id, receipt, credit_token, pack, balance, expires_at, … }. The token is shown here
 *   (and re-derived on an idempotent replay); only its SHA-256 is stored.
 * GET /api/v1/credits/balance  header X-Credit-Token — free.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withX402 } from "@x402/next";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { getPayTo, getPaymentMode, type PaymentMode } from "@/lib/payments/config";
import {
  CREDIT_REFUSAL_MESSAGES,
  accountProblem,
  creditTokenId,
  deriveCreditToken,
  hashCreditToken,
  newCreditAccount,
  parseCreditToken,
} from "@/lib/payments/credits";
import {
  CREDIT_PACKS,
  CREDIT_PACK_LIST,
  CREDIT_TOKEN_HEADER,
  PAID_ENDPOINT_LIST,
  atomicToUsdc,
  isCreditPackId,
  type CreditPackId,
} from "@/lib/payments/pricing";
import { buildReceipt, receiptAsset } from "@/lib/payments/receipt";
import { buildCreditPackRouteConfig, getResourceServer } from "@/lib/payments/server";
import { getStore, type CreditAccount, type ReceiptRecord } from "@/lib/store";
import { ApiError, errorResponse, toApiError } from "./errors";
import { IDEMPOTENT_REPLAY_HEADER, acquireKey, readIdempotencyKey, releaseKey, requestHash } from "./idempotency";
import { CREDIT_BALANCE_HEADER, MAX_BODY_BYTES, copyHeaders, finalizeError, jsonResponse, paidAssetAddress } from "./paid-route";
import { checkRateLimit, clientKey } from "./rate-limit";
import { newRequestId } from "./request-id";

type RouteHandler = (req: NextRequest) => Promise<NextResponse>;

/** What the stored record keeps as "result" of a pack purchase (never the token). */
interface PackPurchaseResult {
  kind: "credit_pack";
  pack: CreditPackId;
  credit_usdc: string;
  credit_atomic: string;
  credit_token_id: string;
  expires_at: string;
}

function balanceView(a: CreditAccount) {
  return {
    credit_token_id: creditTokenId(a.token_hash),
    pack: a.pack,
    balance: atomicToUsdc(a.balance_atomic),
    balance_atomic: a.balance_atomic,
    initial_credit: atomicToUsdc(a.initial_atomic),
    asset: "USDC" as const,
    calls_debited: a.calls,
    expires_at: a.expires_at,
    mode: a.mode,
  };
}

function usage() {
  return {
    header: CREDIT_TOKEN_HEADER,
    how:
      `Send "${CREDIT_TOKEN_HEADER}: <credit_token>" instead of PAYMENT-SIGNATURE on any paid endpoint: the call's USDC price is debited from the balance (receipt.method = "credits", no settlement). ` +
      "Errors are never debited. Keep the token secret: it is a bearer prepaid payment.",
    prices_usdc: Object.fromEntries(PAID_ENDPOINT_LIST.map((e) => [e.path, e.price_usdc])),
    balance_endpoint: "GET /api/v1/credits/balance",
  };
}

/** Body of a purchase response (first time and replays). `token` is null when it cannot be re-derived. */
function purchaseBody(rec: ReceiptRecord, account: CreditAccount | null, token: string | null) {
  const r = rec.result as PackPurchaseResult;
  return {
    request_id: rec.request_id,
    receipt: rec.receipt,
    credit_token: token,
    ...(token
      ? {}
      : {
          credit_token_note:
            "The token cannot be shown again on this instance (it is never stored, only its SHA-256). Retry the purchase replay on the deployment that issued it, or contact the operator.",
        }),
    paid: { amount: rec.receipt.amount, asset: receiptAsset(rec.receipt) },
    ...(account
      ? balanceView(account)
      : { credit_token_id: r.credit_token_id, pack: r.pack, balance: r.credit_usdc, balance_atomic: r.credit_atomic, asset: "USDC", expires_at: r.expires_at }),
    usage: usage(),
  };
}

function innerPackHandler(): RouteHandler {
  return async () => NextResponse.json({ ok: true }, { status: 200 });
}

type Global = typeof globalThis & { __ajeanCreditHandlers?: Map<string, RouteHandler> };
function handlers(): Map<string, RouteHandler> {
  const g = globalThis as Global;
  return (g.__ajeanCreditHandlers ??= new Map());
}

function getPackHandler(pack: CreditPackId, mode: PaymentMode): RouteHandler | null {
  const key = `${mode}:${pack}:${getPayTo(mode)}`;
  let h = handlers().get(key);
  if (h) return h;
  const config = buildCreditPackRouteConfig(pack, mode);
  if (!config) return null;
  h = withX402(innerPackHandler(), config, getResourceServer(mode)) as RouteHandler;
  handlers().set(key, h);
  return h;
}

/** Test helper. */
export function resetCreditRoutes(): void {
  handlers().clear();
}

function readPack(body: unknown, url: URL): CreditPackId {
  const fromBody = body && typeof body === "object" ? (body as { pack?: unknown }).pack : undefined;
  const pack = fromBody ?? url.searchParams.get("pack");
  if (!isCreditPackId(pack)) {
    throw new ApiError("INVALID_CREDIT_PACK", `Unknown credit pack ${JSON.stringify(pack ?? null)}. Send {"pack": ${CREDIT_PACK_LIST.map((p) => `"${p.id}"`).join(" | ")}}.`, {
      details: { packs: CREDIT_PACK_LIST.map((p) => ({ id: p.id, price_usdc: p.price_usdc, credit_usdc: p.credit_usdc })) },
    });
  }
  return pack;
}

async function replayPurchase(rec: ReceiptRecord): Promise<NextResponse> {
  const token = deriveCreditToken(rec.request_id);
  const account = await getStore().getCredit(hashCreditToken(token));
  const body = purchaseBody(rec, account, account ? token : null);
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
    [IDEMPOTENT_REPLAY_HEADER]: "true",
    "X-Request-Id": rec.request_id,
  });
  if (rec.payment_response) headers.set("PAYMENT-RESPONSE", rec.payment_response);
  return new NextResponse(JSON.stringify(body), { status: 200, headers });
}

export async function purchaseCredits(req: NextRequest): Promise<NextResponse> {
  const requestId = newRequestId();
  let heldKey: string | null = null;
  try {
    const wait = checkRateLimit(clientKey(req.headers));
    if (wait !== null) {
      throw new ApiError("RATE_LIMITED", `Too many requests. Retry in ${wait}s.`, {
        headers: { "Retry-After": String(wait) },
        details: { retry_after_seconds: wait },
      });
    }
    const raw = await req.clone().text();
    if (raw.length > MAX_BODY_BYTES) throw new ApiError("PAYLOAD_TOO_LARGE", `Request body exceeds ${MAX_BODY_BYTES} bytes.`);
    let body: unknown = {};
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        throw new ApiError("INVALID_JSON", 'Request body is not valid JSON (send {"pack":"starter"}).');
      }
    }
    const pack = readPack(body, new URL(req.url));
    const idemKey = readIdempotencyKey(req.headers);
    const hash = requestHash("credits", { pack }, raw);

    if (idemKey) {
      const existing = await getStore().getByIdempotencyKey(idemKey);
      if (existing) {
        if (existing.request_hash !== hash) {
          throw new ApiError("IDEMPOTENCY_CONFLICT", "This Idempotency-Key was already used with a different request (body or endpoint).", {
            details: { original_request_id: existing.request_id, original_endpoint: existing.endpoint },
          });
        }
        return await replayPurchase(existing);
      }
      if (!acquireKey(idemKey)) {
        throw new ApiError("IDEMPOTENCY_IN_PROGRESS", "A request with this Idempotency-Key is already in progress. Retry shortly.", {
          headers: { "Retry-After": "2" },
        });
      }
      heldKey = idemKey;
    }

    const mode = getPaymentMode();
    const x402 = getPackHandler(pack, mode);
    if (!x402) throw new ApiError("SERVICE_MISCONFIGURED", "SERVICE_PAY_TO_ADDRESS is not configured for testnet mode. Not charged.");
    const res = await x402(req);
    if (res.status >= 400) return await finalizeError(res, requestId);
    if (res.status !== 200) {
      res.headers.set("X-Request-Id", requestId);
      return res;
    }
    const header = res.headers.get("PAYMENT-RESPONSE");
    if (!header) return errorResponse(new ApiError("INTERNAL", "Settlement response missing. Not charged."), requestId);

    // Settled: issue the token (derived from the request_id, only its hash is stored).
    const settle = decodePaymentResponseHeader(header);
    const p = CREDIT_PACKS[pack];
    const receipt = buildReceipt({
      settle,
      payTo: getPayTo(mode) ?? "",
      mode,
      assetAddress: paidAssetAddress(req.headers),
      listedUsdcAtomic: p.price_atomic,
    });
    const token = deriveCreditToken(requestId);
    const tokenHash = hashCreditToken(token);
    const account = newCreditAccount({
      tokenHash,
      pack,
      mode,
      purchaseRequestId: requestId,
      paidAsset: receipt.asset,
      paidAmountAtomic: receipt.amount_atomic,
      now: new Date(receipt.paid_at),
    });
    const result: PackPurchaseResult = {
      kind: "credit_pack",
      pack,
      credit_usdc: p.credit_usdc,
      credit_atomic: p.credit_atomic,
      credit_token_id: creditTokenId(tokenHash),
      expires_at: account.expires_at,
    };
    const record: ReceiptRecord = {
      request_id: requestId,
      endpoint: "credits",
      idempotency_key: idemKey,
      request_hash: hash,
      receipt,
      result,
      payment_response: header,
      created_at: receipt.paid_at,
    };
    const store = getStore();
    await store.saveCredit(account);
    try {
      await store.saveReceipt(record);
    } catch (e) {
      console.error("[api] could not persist credit purchase receipt:", e instanceof Error ? e.message : e);
    }
    const headers = copyHeaders(res.headers);
    headers.set("Cache-Control", "private, no-store");
    headers.set(CREDIT_BALANCE_HEADER, atomicToUsdc(account.balance_atomic));
    return jsonResponse(purchaseBody(record, account, token), 200, headers, requestId);
  } catch (e) {
    return errorResponse(toApiError(e), requestId);
  } finally {
    if (heldKey) releaseKey(heldKey);
  }
}

/** GET /api/v1/credits/balance — free. */
export async function creditBalance(req: NextRequest): Promise<NextResponse> {
  try {
    const raw = req.headers.get(CREDIT_TOKEN_HEADER);
    if (raw === null) throw new ApiError("NOT_FOUND", `Send the credit token in the ${CREDIT_TOKEN_HEADER} header.`, { status: 404, details: { reason: "missing" } });
    const token = parseCreditToken(raw);
    const account = token ? await getStore().getCredit(hashCreditToken(token)) : null;
    const problem = accountProblem(account, getPaymentMode());
    if (!account || problem === "unknown" || problem === "wrong_mode") {
      const reason = problem ?? "unknown";
      throw new ApiError("NOT_FOUND", CREDIT_REFUSAL_MESSAGES[reason], { details: { reason } });
    }
    return NextResponse.json(
      { ...balanceView(account), expired: problem === "expired", usage: usage() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return errorResponse(toApiError(e));
  }
}
