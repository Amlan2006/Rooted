// Pure spend policy for the paying agent. Amounts are atomic integer strings (tinybars for HBAR).
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

// Session spend = settled payments already logged for this session and asset. A corrupt log fails closed.
export function sessionSpent(jsonl, session, asset) {
  let spent = 0n;
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    const run = JSON.parse(line);
    if (run.session !== session || run.asset !== asset || !run.settled) continue;
    if (!atomic(run.amount)) throw Error("runs log has a non-atomic amount");
    spent += BigInt(run.amount);
  }
  return String(spent);
}

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
