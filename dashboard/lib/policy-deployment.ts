export type Deployment = {
  network: string;
  chain_id: string;
  expected_sender: string;
  contract_name: string;
  policy_values: {
    max_summary_age_seconds: number;
    max_observation_age_seconds: number;
    max_reveal_latency_ms: number;
    max_missing_payloads: number;
    min_observations: number;
    min_timed_samples: number;
  };
  transaction: {
    from: string;
    chainId: string;
    data: string;
    value: string;
    nonce: string;
    gas: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
  };
  estimated_gas: number;
  gas_limit: number;
  maximum_fee_wei: string;
  sufficient_test_balance: boolean;
  prepared_at_block: string;
};
export function validateDeployment(p: Deployment) {
  if (
    p.network !== "sepolia" ||
    p.chain_id !== "11155111" ||
    p.transaction.chainId !== "0xaa36a7" ||
    p.transaction.value !== "0x0" ||
    p.expected_sender.toLowerCase() !== p.transaction.from.toLowerCase() ||
    !/^0x[0-9a-f]{40}$/i.test(p.expected_sender) ||
    !/^0x[0-9a-f]+$/i.test(p.transaction.data) ||
    p.transaction.data.length < 100 ||
    !Number.isSafeInteger(p.gas_limit) ||
    BigInt(p.transaction.gas) !== BigInt(p.gas_limit) ||
    BigInt(p.transaction.maxFeePerGas) * BigInt(p.transaction.gas) !==
      BigInt(p.maximum_fee_wei) ||
    Object.hasOwn(p.transaction, "to")
  )
    throw new Error("Unsupported or inconsistent deployment preparation");
}
export function formatTestETH(wei: string) {
  const n = BigInt(wei);
  return `${n / 10n ** 18n}.${(n % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "") || "0"}`;
}
