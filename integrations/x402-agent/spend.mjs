// Spend policy for the paying agent. Amounts are atomic integer strings (tinybars for HBAR).
import { readFileSync, rmSync, writeFileSync } from "node:fs";

const atomic = (v) => typeof v === "string" && /^\d{1,30}$/.test(v);

export function decide(req, state, limits) {
  const left = BigInt(limits.sessionBudget) - BigInt(state.spent);
  const refuse = (reason) => ({ refused: true, reason, amount: String(req?.amount ?? ""), budget_left: String(left > 0n ? left : 0n) });
  if (!atomic(req?.amount)) return refuse("invalid_amount");
  if (req.network !== limits.network || req.asset !== limits.asset) return refuse("asset_not_allowed");
  if (req.payTo !== limits.payTo) return refuse("untrusted_pay_to");
  const amount = BigInt(req.amount);
  if (amount > BigInt(limits.maxPerRequest)) return refuse("over_per_request_cap");
  if (amount > left) return refuse("session_budget_exceeded");
  return { refused: false, amount: req.amount, budget_left: String(left - amount) };
}

// x402 client policy: the library signs only an offer decide() approved, even when a 402 lists several assets.
export const policy = (state, limits) => (_version, offers) => offers.filter((r) => !decide(r, state, limits).refused);

// Session spend = settled payments plus signed payments still pending, for this session and asset. A run's later
// line replaces its earlier one (pending -> settled, or released when the server proved nothing moved), so money
// in flight counts until settlement is known. A corrupt log fails closed.
export function sessionSpent(jsonl, session, asset) {
  const runs = new Map();
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    const run = JSON.parse(line);
    if (run.session === session && run.asset === asset) runs.set(run.run_id ?? Symbol(), run);
  }
  let spent = 0n;
  for (const run of runs.values()) {
    if (!run.settled && !run.pending) continue;
    if (!atomic(run.amount)) throw Error("runs log has a non-atomic amount");
    spent += BigInt(run.amount);
  }
  return String(spent);
}

// One purchase at a time across processes, held from reading the budget until the run is logged. A lock whose
// owner process is gone is taken over. shortcut: two processes reclaiming the same stale lock can both win; rare.
export function acquireLock(file) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { writeFileSync(file, String(process.pid), { flag: "wx" }); return true; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (alive(Number(readFileSync(file, "utf8")))) return false; // an empty file (owner mid-write) reads as pid 0: alive
      rmSync(file, { force: true });
    }
  }
  return false;
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

export function limitsFrom(env) {
  const limits = {
    network: "hedera:testnet",
    asset: env.ROOTED_X402_HEDERA_ASSET || "0.0.0",
    payTo: env.ROOTED_EXPECTED_PAY_TO ?? "",
    maxPerRequest: env.MAX_PER_REQUEST || "1000000",
    sessionBudget: env.SESSION_BUDGET || "5000000",
  };
  if (!/^0\.0\.[1-9]\d*$/.test(limits.payTo)) throw Error("ROOTED_EXPECTED_PAY_TO must be the trusted Hedera account id, e.g. 0.0.12345");
  if (!/^0\.0\.\d+$/.test(limits.asset)) throw Error("ROOTED_X402_HEDERA_ASSET must be 0.0.0 (HBAR) or an HTS token id");
  if (!atomic(limits.maxPerRequest) || !atomic(limits.sessionBudget)) throw Error("MAX_PER_REQUEST and SESSION_BUDGET must be atomic integers");
  return limits;
}
