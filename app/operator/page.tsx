import type { Metadata } from "next";
import { OperatorDashboard } from "@/components/operator/OperatorDashboard";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Operator view · Ajean Ledger",
  description: "Calls served, USDC earned, revenue per endpoint and recent agent payments.",
};

export default function OperatorPage() {
  return (
    <>
      <SiteHeader active="operator" />
      <main className="container">
        <OperatorDashboard />
        <p className="disclaimer-small" style={{ paddingBottom: 30 }}>
          PoC: testnet only, synthetic data, not a substitute for a chartered accountant&apos;s review.
        </p>
      </main>
    </>
  );
}
