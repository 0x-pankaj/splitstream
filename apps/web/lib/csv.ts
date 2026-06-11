/**
 * CSV helpers for the dashboard's bulk-upload flows (payout batches and payee
 * allowlists), plus address normalization.
 *
 * Address normalization matters for correctness: the compliance allowlist key
 * is `keccak256(addressString)` (see `deriveRecipientKey`), so "0xAbC…" and
 * "0xabc…" would hash to *different* keys and a payout could be rejected even
 * though the "same" payee was vetted. We canonicalize EVM addresses to
 * lowercase everywhere before they reach the backend so the vetting key and the
 * payout key always match. Solana (base58) addresses are case-sensitive and are
 * left untouched.
 */

export const CHAINS = ["base", "arbitrum", "ethereum", "solana"] as const;
export type Chain = (typeof CHAINS)[number];
export type Currency = "USD" | "EUR";

export interface PayoutRow {
  recipientAddress: string;
  targetChain: Chain;
  amountUSDC: string;
  currencyCode: Currency;
}

export interface PayeeRow {
  address: string;
  targetChain: Chain;
  label?: string;
}

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const AMOUNT_RE = /^\d+(\.\d{1,6})?$/;

/** Canonical form used for hashing/comparison: lowercase for EVM, as-is for Solana. */
export function normalizeAddress(address: string, chain: Chain): string {
  const a = address.trim();
  return chain === "solana" ? a : a.toLowerCase();
}

/** True when `address` is syntactically valid for `chain`. */
export function isAddressValidForChain(address: string, chain: Chain): boolean {
  return (chain === "solana" ? SOLANA_RE : EVM_RE).test(address.trim());
}

function asChain(raw: string): Chain | null {
  const c = raw.trim().toLowerCase();
  return (CHAINS as readonly string[]).includes(c) ? (c as Chain) : null;
}

function asCurrency(raw: string | undefined): Currency {
  return (raw ?? "").trim().toUpperCase() === "EUR" ? "EUR" : "USD";
}

/** Split one CSV line, honoring simple double-quoted fields. */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Non-empty, non-comment lines. Drops a header row if the first cell is a known label. */
function dataLines(text: string, headerHints: string[]): string[][] {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .map(splitLine);
  if (rows.length === 0) return rows;
  const first = (rows[0][0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (headerHints.some((h) => first === h)) return rows.slice(1);
  return rows;
}

export interface ParseResult<T> {
  rows: T[];
  errors: string[];
}

/**
 * Parse a payout CSV: `recipientAddress,targetChain,amountUSDC,currencyCode`.
 * `currencyCode` is optional (defaults USD). Invalid rows are reported, not
 * silently dropped, so the user can fix them.
 */
export function parsePayoutCsv(text: string): ParseResult<PayoutRow> {
  const rows: PayoutRow[] = [];
  const errors: string[] = [];
  const lines = dataLines(text, ["recipientaddress", "address", "recipient"]);
  lines.forEach((cells, idx) => {
    const lineNo = idx + 1;
    if (cells.length < 3) {
      errors.push(`Line ${lineNo}: expected at least 3 columns (address, chain, amount)`);
      return;
    }
    const [rawAddr, rawChain, rawAmount, rawCur] = cells;
    const chain = asChain(rawChain);
    if (!chain) {
      errors.push(`Line ${lineNo}: unknown chain "${rawChain}" (use base/arbitrum/ethereum/solana)`);
      return;
    }
    if (!isAddressValidForChain(rawAddr, chain)) {
      errors.push(`Line ${lineNo}: "${rawAddr}" is not a valid ${chain} address`);
      return;
    }
    if (!AMOUNT_RE.test(rawAmount) || Number(rawAmount) <= 0) {
      errors.push(`Line ${lineNo}: invalid amount "${rawAmount}" (positive, ≤ 6 decimals)`);
      return;
    }
    rows.push({
      recipientAddress: normalizeAddress(rawAddr, chain),
      targetChain: chain,
      amountUSDC: rawAmount,
      currencyCode: asCurrency(rawCur),
    });
  });
  return { rows, errors };
}

/** Parse a payee CSV: `address,targetChain,label`. `label` is optional. */
export function parsePayeeCsv(text: string): ParseResult<PayeeRow> {
  const rows: PayeeRow[] = [];
  const errors: string[] = [];
  const lines = dataLines(text, ["address", "recipientaddress", "recipient"]);
  lines.forEach((cells, idx) => {
    const lineNo = idx + 1;
    if (cells.length < 2) {
      errors.push(`Line ${lineNo}: expected at least 2 columns (address, chain)`);
      return;
    }
    const [rawAddr, rawChain, rawLabel] = cells;
    const chain = asChain(rawChain);
    if (!chain) {
      errors.push(`Line ${lineNo}: unknown chain "${rawChain}"`);
      return;
    }
    if (!isAddressValidForChain(rawAddr, chain)) {
      errors.push(`Line ${lineNo}: "${rawAddr}" is not a valid ${chain} address`);
      return;
    }
    rows.push({
      address: normalizeAddress(rawAddr, chain),
      targetChain: chain,
      label: rawLabel ? rawLabel.trim() : undefined,
    });
  });
  return { rows, errors };
}

export const PAYOUT_CSV_TEMPLATE = `recipientAddress,targetChain,amountUSDC,currencyCode
0x1111111111111111111111111111111111111111,base,250,USD
0x2222222222222222222222222222222222222222,arbitrum,1200,USD
0x3333333333333333333333333333333333333333,ethereum,60000,USD
`;

export const PAYEE_CSV_TEMPLATE = `address,targetChain,label
0x1111111111111111111111111111111111111111,base,Acme Studios
0x2222222222222222222222222222222222222222,arbitrum,Contractor — EU
`;

/** Trigger a client-side download of a text file (CSV template export). */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
