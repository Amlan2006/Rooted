import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { FacilitatorClient } from "@x402/core/server";
import { paidXray, x402Config } from "../lib/x402";

const hash = "0x" + "ab".repeat(32), payTo = "0.0.7001", feePayer = "0.0.9185802", txId = "0.0.9185802@1793957841.000000001";
const on = { ROOTED_X402_ENABLED: "true", ROOTED_X402_PAY_TO: payTo };
const url = (h = hash) => `http://127.0.0.1:3005/api/paid/xray/${h}`;
const report = (h = hash) => ({ data: { schema: "rooted-xray-v1", block: { hash: h, number: 1 } } });

function facilitator() {
  const calls = { verify: 0, settle: 0 };
  const client: FacilitatorClient = {
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer } }], extensions: [], signers: {} }),
    verify: async () => { calls.verify++; return { isValid: true, payer: "0.0.8001" }; },
    settle: async () => { calls.settle++; return { success: true, transaction: txId, network: "hedera:testnet", payer: "0.0.8001" }; },
  };
  return { client, calls };
}
// A payment that the mocked facilitator accepts; the real signature is checked by the facilitator, not here.
async function paidRequest(GET: (r: NextRequest) => Promise<Response>, h = hash) {
  const required = decodePaymentRequiredHeader((await GET(new NextRequest(url(h)))).headers.get("PAYMENT-REQUIRED")!);
  const signature = encodePaymentSignatureHeader({ x402Version: 2, resource: required.resource, accepted: required.accepts[0], payload: { transaction: "AA==" } });
  return new NextRequest(url(h), { headers: { "PAYMENT-SIGNATURE": signature } });
}

test("x402 config is off by default, applies defaults and rejects bad values", () => {
  for (const env of [{}, { ROOTED_X402_ENABLED: "1" }, { ROOTED_X402_ENABLED: "false", ROOTED_X402_PAY_TO: payTo }]) assert.equal(x402Config(env), null);
  assert.deepEqual(x402Config(on), { payTo, asset: "0.0.0", amount: "1000000", facilitatorURL: "https://x402.org/facilitator", maxTimeoutSeconds: 120 });
  assert.deepEqual(x402Config({ ...on, ROOTED_X402_HEDERA_ASSET: "0.0.429274", ROOTED_X402_PRICE_ATOMIC: "10000", ROOTED_X402_FACILITATOR_URL: "https://api.testnet.blocky402.com/", ROOTED_X402_MAX_TIMEOUT_SECONDS: "60" }),
    { payTo, asset: "0.0.429274", amount: "10000", facilitatorURL: "https://api.testnet.blocky402.com", maxTimeoutSeconds: 60 });
  for (const bad of [
    { ROOTED_X402_PAY_TO: "" }, { ROOTED_X402_PAY_TO: "0.0.0000000" }, { ROOTED_X402_PAY_TO: "0.0.abc" }, { ROOTED_X402_PAY_TO: "1.2.3" },
    { ROOTED_X402_HEDERA_ASSET: "USDC" }, { ROOTED_X402_PRICE_ATOMIC: "0" }, { ROOTED_X402_PRICE_ATOMIC: "1.5" }, { ROOTED_X402_PRICE_ATOMIC: "-1" },
    { ROOTED_X402_FACILITATOR_URL: "http://x402.org/facilitator" }, { ROOTED_X402_FACILITATOR_URL: "https://u:p@x402.org" },
    { ROOTED_X402_MAX_TIMEOUT_SECONDS: "0" }, { ROOTED_X402_MAX_TIMEOUT_SECONDS: "181" },
  ]) assert.throws(() => x402Config({ ...on, ...bad }), JSON.stringify(bad));
});

test("disabled paid route is a 404 that names the free self-host route", async () => {
  const response = await paidXray(null)(new NextRequest(url()));
  assert.equal(response.status, 404);
  assert.match((await response.json()).error.message, /\/api\/v1\/xray\/blocks\/<hash>\?network=sepolia/);
});

test("unpaid request gets a hedera:testnet PAYMENT-REQUIRED; malformed hash is rejected before payment", async (t) => {
  const backend = t.mock.method(globalThis, "fetch", async () => Response.json(report()));
  const GET = paidXray(x402Config(on), facilitator().client);
  for (const bad of ["0x" + "AB".repeat(32), "0x1234", "latest"]) assert.equal((await GET(new NextRequest(url(bad)))).status, 400);
  const response = await GET(new NextRequest(url()));
  assert.equal(response.status, 402);
  const required = decodePaymentRequiredHeader(response.headers.get("PAYMENT-REQUIRED")!);
  assert.equal(required.x402Version, 2);
  assert.match(required.resource.url, /\/api\/paid\/xray\/0x(ab){32}$/);
  assert.deepEqual(required.accepts.map(({ scheme, network, payTo, amount, asset, maxTimeoutSeconds, extra }) => ({ scheme, network, payTo, amount, asset, maxTimeoutSeconds, feePayer: extra?.feePayer })),
    [{ scheme: "exact", network: "hedera:testnet", payTo, amount: "1000000", asset: "0.0.0", maxTimeoutSeconds: 120, feePayer }]);
  assert.equal(backend.mock.callCount(), 0);
});

test("settlement only follows a valid < 400 report; 404, invalid body and backend failure are never charged", async (t) => {
  let next: () => Promise<Response> = async () => Response.json(report());
  const backend = t.mock.method(globalThis, "fetch", async (input: URL) => {
    assert.equal(input.pathname + input.search, `/api/v1/xray/blocks/${hash}?network=sepolia`);
    return next();
  });
  const { client, calls } = facilitator(), GET = paidXray(x402Config(on), client);
  for (const [status, reply] of [
    [404, async () => Response.json({ error: { code: "not_found" } }, { status: 404 })],
    [502, async () => Response.json(report("0x" + "cd".repeat(32)))],
    [502, async () => new Response("not json")],
    [502, async () => { throw new TypeError("connect ECONNREFUSED"); }],
  ] as const) {
    next = reply;
    const response = await GET(await paidRequest(GET));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("PAYMENT-RESPONSE"), null);
  }
  assert.equal(calls.settle, 0);
  assert.equal(calls.verify, 4);
  next = async () => Response.json(report());
  const response = await GET(await paidRequest(GET));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.block.hash, hash);
  assert.deepEqual(decodePaymentResponseHeader(response.headers.get("PAYMENT-RESPONSE")!), { success: true, transaction: txId, network: "hedera:testnet", payer: "0.0.8001" });
  assert.equal(calls.settle, 1);
  assert.equal(backend.mock.callCount(), 5);
});
