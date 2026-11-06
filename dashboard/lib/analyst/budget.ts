import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Usage } from "./types";

// Claude Opus 5.5 list prices, USD per million tokens (5-minute cache writes).
export const PRICES = { input: 4, output: 20, cache_read: 0.2, cache_write: 5 };
export const cost = (u: Omit<Usage, "usd">) =>
  (u.input * PRICES.input + u.output * PRICES.output + u.cache_read * PRICES.cache_read + u.cache_write * PRICES.cache_write) / 1e6;

export function dailyLimit() {
  const limit = Number(process.env.ROOTED_ANALYST_DAILY_USD || 20);
  return Number.isFinite(limit) && limit >= 0 ? limit : 20;
}

export type LedgerRow = Usage & { at: string; mode: "investigate" | "brief" };
export interface Ledger { spent(day: string): Promise<number>; add(row: LedgerRow): Promise<void> }

// Append-only JSONL, one row per model call, so the daily cap survives restarts and is shared with `npm run briefs`.
// Both the dashboard and the briefs script run from dashboard/, so the ledger lands in the repo's ignored .tools/.
export function fileLedger(file = path.resolve(process.cwd(), "..", ".tools", "analyst", "usage.jsonl")): Ledger {
  return {
    async spent(day) {
      let text = "";
      try { text = await readFile(/*turbopackIgnore: true*/ file, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      let total = 0;
      for (const line of text.split("\n")) {
        if (!line) continue;
        try { const row = JSON.parse(line) as LedgerRow; if (row.at?.startsWith(day) && Number.isFinite(row.usd)) total += row.usd; } catch { /* a torn last line */ }
      }
      return total;
    },
    async add(row) {
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, JSON.stringify(row) + "\n");
    },
  };
}

// UTC day, matching the ISO timestamps in the ledger.
export const overBudget = async (ledger: Ledger, now: Date) => (await ledger.spent(now.toISOString().slice(0, 10))) >= dailyLimit();
