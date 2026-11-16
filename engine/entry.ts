/** Journal-entry helpers: account lines in integer cents, balance check, conversion. */
import type { EntryLine, JournalEntry } from "./types";
import { fromCents } from "./money";

export interface CentsLine {
  account: string;
  label: string;
  debit: number; // cents
  credit: number; // cents
}

/** Merge lines with the same account+label and side, keeping the first-appearance order. */
export function mergeLines(lines: CentsLine[]): CentsLine[] {
  const out: CentsLine[] = [];
  for (const l of lines) {
    if (l.debit === 0 && l.credit === 0) continue;
    const side = l.debit !== 0 ? "D" : "C";
    const hit = out.find((o) => o.account === l.account && o.label === l.label && (o.debit !== 0 ? "D" : "C") === side);
    if (hit) {
      hit.debit += l.debit;
      hit.credit += l.credit;
    } else out.push({ ...l });
  }
  return out;
}

export function reverseLines(lines: CentsLine[]): CentsLine[] {
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
}

export function totalsCents(lines: { debit: number; credit: number }[]): { debit: number; credit: number } {
  return lines.reduce((a, l) => ({ debit: a.debit + l.debit, credit: a.credit + l.credit }), { debit: 0, credit: 0 });
}

export function toEntryLines(lines: CentsLine[]): EntryLine[] {
  return lines.map((l) => ({ account: l.account, label: l.label, debit: fromCents(l.debit), credit: fromCents(l.credit) }));
}

/** Balance check on output lines (numbers with 2 decimals), to the cent. */
export function isBalanced(lines: { debit: number; credit: number }[]): boolean {
  let d = 0;
  let c = 0;
  for (const l of lines) {
    d += Math.round(l.debit * 100);
    c += Math.round(l.credit * 100);
  }
  return d === c;
}

export function buildEntry(journal: JournalEntry["journal"], date: string, reference: string, lines: CentsLine[]): JournalEntry {
  const merged = mergeLines(lines);
  const t = totalsCents(merged);
  return { journal, date, reference, lines: toEntryLines(merged), balanced: t.debit === t.credit && t.debit > 0 };
}
