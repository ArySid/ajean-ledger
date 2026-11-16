import type { Metadata, Viewport } from "next";
import "./globals.css";

const ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#121a29"/><path d="M9 23 16 8l7 15" fill="none" stroke="#63b0ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 18h8" stroke="#7fd8f5" stroke-width="3" stroke-linecap="round"/></svg>`,
  );

export const metadata: Metadata = {
  title: "Ajean Ledger: accounting API for AI agents, paid in USDC",
  description:
    "An API that lets AI agents send a French invoice and get back a validated, machine-readable accounting entry, paid per call in USDC via x402. Built for agents, not humans. PoC, testnet only.",
  icons: { icon: ICON },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0e16",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
