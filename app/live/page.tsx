import type { Metadata } from "next";
import { LiveConsole } from "@/components/live/LiveConsole";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Live agent console · Ajean Ledger",
  description: "Watch an AI agent discover Ajean Ledger, pay 0.15 USDC over HTTP 402 and receive a validated accounting entry.",
};

export default function LivePage() {
  return (
    <>
      <SiteHeader active="live" />
      <main>
        <h1 className="sr-only">Live agent console</h1>
        <LiveConsole />
      </main>
    </>
  );
}
