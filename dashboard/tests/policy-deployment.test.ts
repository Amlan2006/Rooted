import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateDeployment,
  formatTestETH,
  type Deployment,
} from "../lib/policy-deployment";
const sample = {
  network: "sepolia",
  chain_id: "11155111",
  expected_sender: "0x" + "1".repeat(40),
  transaction: {
    from: "0x" + "1".repeat(40),
    chainId: "0xaa36a7",
    value: "0x0",
    data: "0x" + "a".repeat(200),
    nonce: "0x1",
    gas: "0x186a0",
    maxFeePerGas: "0x5",
    maxPriorityFeePerGas: "0x1",
  },
  gas_limit: 100000,
  maximum_fee_wei: "500000",
} as Deployment;
test("unsigned policy creation is restricted to the prepared Sepolia account and zero transfer value", () => {
  assert.doesNotThrow(() => validateDeployment(sample));
  for (const change of [
    { chainId: "0x1" },
    { value: "0x1" },
    { from: "0x" + "2".repeat(40) },
    { to: "0x" + "3".repeat(40) },
    { gas: "0x1" },
  ])
    assert.throws(() =>
      validateDeployment({
        ...sample,
        transaction: { ...sample.transaction, ...change },
      }),
    );
  assert.throws(() => validateDeployment({ ...sample, maximum_fee_wei: "1" }));
});
test("test ETH fee formatting keeps exact integer precision", () => {
  assert.equal(formatTestETH("170798320"), "0.00000000017079832");
  assert.equal(formatTestETH("1000000000000000000"), "1.0");
});
