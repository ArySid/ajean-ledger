import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { priceOfPath } from "@/lib/console/pricing";

export const metadata: Metadata = {
  title: "Virtual office · Ajean Ledger",
  description: "A light nod to Ajean's virtual office: agent visitors arrive, pay in USDC and leave with their accounting entry.",
};

export default function OfficePage() {
  const price = priceOfPath("/api/v1/entry") ?? "0.15";
  return (
    <>
      <SiteHeader active="office" />
      <main className="container">
        <div className="page-head">
          <div>
            <span className="kicker">A nod to Ajean&apos;s virtual office</span>
            <h1>The front desk where agents are the customers</h1>
            <p>
              Ajean Ledger takes the accounting brain of Ajean&apos;s virtual office and opens it to other AI agents. Visitors arrive, pay{" "}
              <span className="money">{price} USDC</span>, and leave with a validated entry.
            </p>
          </div>
          <Link href="/live" className="btn btn-primary">
            See the real traffic →
          </Link>
        </div>
        <div className="office" role="img" aria-label="Animated illustration: agents arrive at the desk, pay in USDC and leave with a document">
          <div className="clerk" />
          <div className="desk">AJEAN LEDGER</div>
          <div className="floor" />
          <div>
            {[0, 1, 2].map((i) => (
              <div className="visitor" key={i}>
                <span className="coin">{price} USDC</span>
                <div className="head" />
                <div className="body" />
                <span className="doc" />
              </div>
            ))}
          </div>
        </div>
        <div className="office-legend">
          <span>
            <b style={{ color: "var(--agent)" }}>■</b> purchasing agent
          </span>
          <span>
            <b style={{ color: "var(--violet)" }}>■</b> expense agent
          </span>
          <span>
            <b style={{ color: "var(--ok)" }}>■</b> accounting-firm pre-bookkeeping agent
          </span>
          <span>
            <b style={{ color: "var(--usdc)" }}>●</b> USDC payment (x402)
          </span>
        </div>
        <p className="disclaimer-small" style={{ padding: "24px 0 30px" }}>
          Illustration only. PoC: testnet only, synthetic data.
        </p>
      </main>
    </>
  );
}
