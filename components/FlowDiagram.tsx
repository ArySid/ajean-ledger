import { priceOfPath, PAYMENT_NETWORK } from "@/lib/console/pricing";

function Arrow() {
  return (
    <div className="flow-arrow" aria-hidden="true">
      <svg viewBox="0 0 36 36">
        <path d="M4 18h24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M21 10l8 8-8 8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** The 4-step x402 flow: Request → 402 → USDC payment → Result. */
export function FlowDiagram() {
  const price = priceOfPath("/api/v1/entry") ?? "0.15";
  const atomic = String(Math.round(Number(price) * 1_000_000));
  return (
    <figure style={{ margin: 0 }} aria-label="x402 payment flow in four steps">
      <div className="flow-actors">
        <span>
          <b style={{ color: "var(--agent)" }}>AI agent</b> (its own USDC wallet, spending policy)
        </span>
        <span>
          <b style={{ color: "var(--usdc)" }}>Ajean Ledger API</b> (payTo wallet)
        </span>
      </div>
      <div className="flow">
        <div className="flow-step" style={{ ["--c" as string]: "var(--agent)" }}>
          <span className="n">STEP 1 · AGENT →</span>
          <h3>Request</h3>
          <p>The agent posts the invoice as JSON. No account, no API key.</p>
          <code>POST /api/v1/entry{"\n"}{`{ "input": { "format": "json", … } }`}</code>
        </div>
        <Arrow />
        <div className="flow-step" style={{ ["--c" as string]: "var(--warn)" }}>
          <span className="n">STEP 2 · ← SERVICE</span>
          <h3>402 Payment Required</h3>
          <p>The price comes back in machine-readable form.</p>
          <code>
            PAYMENT-REQUIRED:{"\n"}
            {`${price} USDC (${atomic})`}
            {"\n"}
            {`network ${PAYMENT_NETWORK}`}
          </code>
        </div>
        <Arrow />
        <div className="flow-step" style={{ ["--c" as string]: "var(--usdc)" }}>
          <span className="n">STEP 3 · AGENT →</span>
          <h3>USDC payment</h3>
          <p>x402 on Base Sepolia: the agent signs an EIP-3009 transfer and retries.</p>
          <code>PAYMENT-SIGNATURE:{"\n"}signed authorisation</code>
        </div>
        <Arrow />
        <div className="flow-step" style={{ ["--c" as string]: "var(--ok)" }}>
          <span className="n">STEP 4 · ← SERVICE</span>
          <h3>Result</h3>
          <p>200 + the PCG entry, VAT, compliance, anomalies and the tx hash.</p>
          <code>PAYMENT-RESPONSE:{"\n"}{`{ success, transaction }`}</code>
        </div>
      </div>
    </figure>
  );
}
