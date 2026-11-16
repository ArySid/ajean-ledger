import Link from "next/link";

export type NavKey = "home" | "live" | "operator" | "office";

const LINKS: { key: NavKey; href: string; label: string }[] = [
  { key: "home", href: "/", label: "Overview" },
  { key: "live", href: "/live", label: "Live agent console" },
  { key: "operator", href: "/operator", label: "Operator" },
  { key: "office", href: "/office", label: "Office" },
];

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#182235" />
      <path d="M9 23 16 8l7 15" fill="none" stroke="#63b0ff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 18h8" stroke="#7fd8f5" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Server component: each page passes its own `active` key (no client hook needed). */
export function SiteHeader({ active }: { active: NavKey }) {
  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="Ajean Ledger home">
        <BrandMark />
        <span>Ajean Ledger</span>
      </Link>
      <nav className="nav" aria-label="Main">
        {LINKS.map((l) => (
          <Link key={l.key} href={l.href} aria-current={active === l.key ? "page" : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>
      <span className="header-tag">PoC · Base Sepolia testnet · synthetic data</span>
    </header>
  );
}
