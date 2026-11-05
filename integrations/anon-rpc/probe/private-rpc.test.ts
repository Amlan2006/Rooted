import { test } from "node:test";
import assert from "node:assert/strict";
import { PrivateRPC, SPECIFIER, type Worker } from "./private-rpc.ts";
function reply(value: unknown) {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: 1, result: value }),
    { headers: { "content-type": "application/json" } },
  );
}
function method(init?: RequestInit) {
  return JSON.parse(String(init?.body)).method as string;
}
test("anonymous requests use worker; direct fetch is limited to specifier bootstrap", async () => {
  const directMethods: string[] = [],
    workerMethods: string[] = [];
  let closed = false;
  const direct: typeof fetch = async (_url, init) => {
    directMethods.push(method(init));
    return reply("0x00");
  };
  const workerFetch: typeof fetch = async (_url, init) => {
    const m = method(init);
    workerMethods.push(m);
    return reply(m === "eth_chainId" ? "0xaa36a7" : "0x123");
  };
  const transport = new PrivateRPC(async (init) => {
    await init.preExisting!.rpcProvider!.request({
      method: "eth_call",
      params: [{ to: SPECIFIER }, "latest"],
    });
    await assert.rejects(
      init.preExisting!.rpcProvider!.request({
        method: "eth_getBalance",
        params: [],
      }),
    );
    return {
      ready: Promise.resolve(),
      fetch: workerFetch,
      close() {
        closed = true;
      },
    };
  }, direct);
  assert.equal(await transport.request("eth_blockNumber", []), "0x123");
  assert.deepEqual(directMethods, ["eth_call"]);
  assert.deepEqual(workerMethods, ["eth_chainId", "eth_blockNumber"]);
  assert.equal(transport.state.bootstrapReads, 1);
  assert.equal(transport.state.status, "ready");
  transport.close();
  assert.equal(closed, true);
});
test("worker startup failure never triggers a direct investigation fallback", async () => {
  let directCalls = 0;
  const transport = new PrivateRPC(
    async () => ({
      ready: Promise.reject(new Error("relay unavailable")),
      fetch: async () => {
        throw Error("never");
      },
      close() {},
    }),
    async () => {
      directCalls++;
      return reply("0xaa36a7");
    },
  );
  await assert.rejects(
    transport.request("eth_chainId", []),
    /relay unavailable/,
  );
  assert.equal(transport.state.status, "failed");
  assert.equal(directCalls, 0);
  await assert.rejects(transport.request("eth_blockNumber", []), /Reconnect/);
  assert.equal(directCalls, 0);
});
test("RPC failure and timeout fail closed; direct mode requires explicit selection", async () => {
  let directCalls = 0,
    closed = 0;
  const direct: typeof fetch = async () => {
    directCalls++;
    return reply("0xaa36a7");
  };
  const transport = new PrivateRPC(
    async () => ({
      ready: Promise.resolve(),
      fetch: async (_url, init) =>
        method(init) === "eth_chainId"
          ? reply("0xaa36a7")
          : new Response('{"error":{"code":-1,"message":"unsupported"}}'),
      close() {
        closed++;
      },
    }),
    direct,
  );
  await assert.rejects(transport.request("eth_getLogs", []), /unsupported/);
  assert.equal(directCalls, 0);
  assert.equal(closed, 1);
  assert.equal(transport.state.status, "failed");
  transport.setMode("direct");
  assert.equal(await transport.request("eth_chainId", []), "0xaa36a7");
  assert.equal(directCalls, 2);
  assert.equal(transport.state.mode, "direct");
  transport.close();
  const timeout = new PrivateRPC(
    async () => ({ ready: new Promise(() => {}), fetch: direct, close() {} }),
    direct,
    10,
  );
  await assert.rejects(timeout.request("eth_blockNumber", []), /timed out/);
  assert.equal(timeout.state.status, "failed");
  assert.equal(directCalls, 2);
});
test("write methods are rejected before worker creation or network access", async () => {
  const transport = new PrivateRPC(
    async () => {
      throw Error("should not construct");
    },
    async () => {
      throw Error("should not fetch");
    },
  );
  await assert.rejects(
    transport.request("eth_sendRawTransaction", ["0x"]),
    /Only supported/,
  );
  assert.equal(transport.state.status, "idle");
});
test("closing during async construction closes the stale worker", async () => {
  let release: (worker: Worker) => void = () => {},
    closed = 0;
  const transport = new PrivateRPC(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    async () => reply("0xaa36a7"),
  );
  const pending = transport.connect();
  transport.close();
  release({
    ready: Promise.resolve(),
    fetch: async () => reply("0xaa36a7"),
    close() {
      closed++;
    },
  });
  await assert.rejects(pending, /closed/);
  assert.equal(closed, 1);
  assert.equal(transport.state.status, "closed");
});

test("real failure check closes the worker before reading and stays failed", async () => {
  let closed = false,
    directCalls = 0;
  const transport = new PrivateRPC(
    async () => ({
      ready: Promise.resolve(),
      fetch: async () => {
        if (closed) throw Error("Worker is closed");
        return reply("0xaa36a7");
      },
      close() {
        closed = true;
      },
    }),
    async () => {
      directCalls++;
      return reply("0xaa36a7");
    },
  );
  await transport.connect();
  await assert.rejects(transport.testWorkerFailure(), /closed/);
  assert.equal(directCalls, 0);
  assert.equal(transport.state.status, "failed");
});
