"use client";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  LockKeyhole,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import {
  PrivateRPC,
  SPECIFIER,
  DESTINATION,
  type TransportState,
} from "@/lib/private-rpc";
import { Badge, Panel, Stat } from "./ui";
import { ms, short } from "@/lib/data";
const TX = "0x4a32623f9cc2e432e77e3d0ec267d64b87fc21a0ee38960563881844389cc72f";
const POOL = "0x3289680dd4d6c10bb19b899729cda5eef58aeff1";
export default function RpcInspector() {
  const [transport] = useState(() => new PrivateRPC());
  const [state, setState] = useState<TransportState>(transport.state);
  const [method, setMethod] = useState("eth_getBlockByNumber");
  const [input, setInput] = useState(TX);
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const remove = transport.subscribe(setState);
    return () => {
      remove();
      transport.close();
    };
  }, [transport]);
  async function connect() {
    setBusy(true);
    setError("");
    try {
      if (
        transport.state.status === "failed" ||
        transport.state.status === "closed"
      )
        transport.setMode(transport.state.mode);
      await transport.connect();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  }
  async function run() {
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      let params: unknown[] = [];
      if (method === "eth_getBlockByNumber") params = ["latest", false];
      if (method === "eth_getTransactionReceipt") {
        if (!/^0x[0-9a-fA-F]{64}$/.test(input))
          throw new Error("Enter a 32-byte transaction hash");
        params = [input];
      }
      if (method === "eth_call")
        params = [{ to: POOL, data: "0x3850c7bd" }, "latest"];
      if (method === "eth_getLogs") {
        const head = (await transport.request("eth_blockNumber", [])) as string;
        params = [
          {
            address: POOL,
            fromBlock:
              "0x" +
              (BigInt(head) > 64n ? BigInt(head) - 64n : 0n).toString(16),
            toBlock: head,
            topics: [
              "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67",
            ],
          },
        ];
      }
      setResult(await transport.request(method, params));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="privacy-intro">
        <div className="privacy-emblem">
          <ShieldCheck size={30} />
        </div>
        <div>
          <span className="eyebrow">Anon-RPC / execution reads</span>
          <h2>Investigate with a private route.</h2>
          <p>
            Nox carries supported execution reads through a sandboxed Sphinx
            mixnet worker. Backend observations use a separate connection.
          </p>
        </div>
      </div>
      <div className="stats">
        <Stat
          label="Transport"
          tone="word"
          value={state.mode === "anonymous" ? "Nox" : "Direct"}
          detail={
            state.mode === "anonymous"
              ? "Default · anonymizing worker"
              : "Explicit fallback · IP exposed"
          }
        />
        <Stat
          label="Worker"
          tone="word"
          value={state.status}
          detail={"Ready time: " + ms(state.readyMS)}
        />
        <Stat
          label="Last RPC duration"
          value={ms(state.latencyMS)}
          detail="Browser transport time only"
        />
        <Stat
          label="Completed reads"
          value={state.requests}
          detail={`${state.bootstrapReads} direct specifier reads`}
        />
      </div>
      <div className="two-columns">
        <Panel
          title="RPC investigation"
          subtitle="Destination: Sepolia · chain 11155111"
          action={
            <Badge tone={state.status === "ready" ? "green" : state.status === "idle" ? "neutral" : "amber"}>
              {state.status.charAt(0).toUpperCase() + state.status.slice(1)}
            </Badge>
          }
        >
          <div className="transport-switch">
            <button
              className={state.mode === "anonymous" ? "selected" : ""}
              disabled={busy}
              onClick={() => {
                transport.setMode("anonymous");
                setResult(undefined);
                setError("");
              }}
            >
              <LockKeyhole size={15} />
              Anonymous · Nox
            </button>
            <button
              className={state.mode === "direct" ? "selected direct" : ""}
              disabled={busy}
              onClick={() => {
                transport.setMode("direct");
                setResult(undefined);
                setError("");
              }}
            >
              Direct · exposes IP
            </button>
          </div>
          {state.mode === "direct" && (
            <div className="notice warning">
              Direct mode is explicitly selected. Investigation requests expose
              your IP to the destination RPC.
            </div>
          )}
          <div className="form">
            <label htmlFor="rpc-method">Execution read</label>
            <select
              id="rpc-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option value="eth_getBlockByNumber">Latest block header</option>
              <option value="eth_chainId">Network identity</option>
              <option value="eth_getTransactionReceipt">
                Transaction receipt
              </option>
              <option value="eth_call">Uniswap v3 pool · slot0</option>
              <option value="eth_getLogs">
                Uniswap Swap logs · last 64 blocks
              </option>
            </select>
            {method === "eth_getTransactionReceipt" && (
              <>
                <label htmlFor="receipt-hash">Sepolia transaction hash</label>
                <input
                  id="receipt-hash"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  spellCheck={false}
                />
              </>
            )}
            <div className="button-row">
              <button
                className="primary"
                onClick={() => void run()}
                disabled={busy || state.status === "failed"}
              >
                {busy ? "Request in progress…" : "Run read"}
                <ArrowUpRight size={16} />
              </button>
              <button onClick={() => void connect()} disabled={busy}>
                {state.status === "failed" ? "Reconnect" : "Connect"}
              </button>
              <button
                aria-label="Disconnect worker"
                disabled={busy}
                onClick={() => transport.close()}
              >
                <Unplug size={16} />
              </button>
            </div>
            {(error || state.error) && (
              <div className="notice error" role="alert">
                {error || state.error} No automatic direct fallback.
              </div>
            )}
            <p className="muted small">
              A direct bootstrap discovers the worker before the mixnet is
              available. The harness verifies the bundle against the specifier’s
              hash. Destination chain:{" "}
              {state.chainID === "0xaa36a7"
                ? "Sepolia verified"
                : "not checked yet"}
              .
            </p>
          </div>
          {result !== undefined && (
            <div className="rpc-result">
              <div>
                <Badge tone={state.mode === "anonymous" ? "green" : "amber"}>
                  {state.mode} result
                </Badge>
                <span>{ms(state.latencyMS)}</span>
              </div>
              <pre tabIndex={0}>{JSON.stringify(result, null, 2)}</pre>
            </div>
          )}
        </Panel>
        <Panel
          title="Transport activity"
          subtitle="Readiness and worker diagnostics"
        >
          <div className="terminal" aria-live="polite">
            {state.logs.length ? (
              state.logs.map((line, i) => (
                <div key={i}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  {line}
                </div>
              ))
            ) : (
              <p>
                Connect Nox to begin. No investigation request has been made.
              </p>
            )}
          </div>
          <div className="failure-check">
            <button
              disabled={
                busy || state.mode !== "anonymous" || state.status !== "ready"
              }
              onClick={async () => {
                setBusy(true);
                setError("");
                setResult(undefined);
                try {
                  await transport.testWorkerFailure();
                  setError("Unexpected success; inspect transport state");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Worker stopped");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Test worker failure
            </button>
            <span>Closes Nox and attempts a read. No fallback is allowed.</span>
          </div>
          <div className="connection-facts">
            <span>Specifier</span>
            <code title={SPECIFIER}>{short(SPECIFIER)}</code>
            <span>Destination RPC</span>
            <code>{new URL(DESTINATION).hostname}</code>
            <span>Fallback policy</span>
            <strong>
              Fail closed <Check size={13} />
            </strong>
          </div>
        </Panel>
      </div>
      <Panel
        title="What this route protects"
        subtitle="Privacy boundaries are part of the evidence."
      >
        <div className="privacy-grid">
          <div>
            <h3>Browser execution reads</h3>
            <p>
              Headers, receipts, logs, and contract reads use Nox by default.
              Query contents are still visible to the destination RPC.
              Worker/network operators remain a trust dependency.
            </p>
          </div>
          <div>
            <h3>Bootstrap & discovery</h3>
            <p>
              Specifier discovery, bundle resolution, and relay connections have
              separate network visibility. The bootstrap provider is trusted for
              the worker hash.
            </p>
          </div>
          <div>
            <h3>Rooted observations</h3>
            <p>
              Dashboard API/SSE requests and server-side collectors are ordinary
              traffic. Nox does not anonymize them or subsequent uploads. No
              signing keys are used here.
            </p>
          </div>
        </div>
      </Panel>
    </>
  );
}
