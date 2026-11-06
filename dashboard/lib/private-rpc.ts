import type { WorkerInit, LogEntry } from "@anon-rpc/browser-harness";
export const DESTINATION = "https://ethereum-sepolia-rpc.publicnode.com";
export const SPECIFIER = "0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A";
export const READ_METHODS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionReceipt",
  "eth_getLogs",
  "eth_call",
]);
export type Worker = {
  ready: Promise<void>;
  fetch: typeof fetch;
  close(): void;
  acceptLog?(): Promise<LogEntry>;
};
export type TransportState = {
  mode: "anonymous" | "direct";
  status: "idle" | "starting" | "ready" | "failed" | "closed";
  error?: string;
  readyMS?: number;
  latencyMS?: number;
  requests: number;
  bootstrapReads: number;
  logs: string[];
  chainID?: string;
};
type Factory = (init: WorkerInit) => Promise<Worker>;
const factory: Factory = async (init) => {
  const { AnonRpcWorker } = await import("@anon-rpc/browser-harness");
  return new AnonRpcWorker(init);
};
function deadline<T>(promise: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new Error("Transport timed out; no direct fallback was made.")),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
export class PrivateRPC {
  state: TransportState = {
    mode: "anonymous",
    status: "idle",
    requests: 0,
    bootstrapReads: 0,
    logs: [],
  };
  private worker?: Worker;
  private boot?: Promise<void>;
  private generation = 0;
  private listeners = new Set<(state: TransportState) => void>();
  constructor(
    private create: Factory = factory,
    private direct: typeof fetch = fetch,
    private timeout = 45000,
  ) {}
  subscribe(listener: (state: TransportState) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private update(patch: Partial<TransportState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn(this.state));
  }
  private log(message: string) {
    this.update({ logs: [...this.state.logs.slice(-39), message] });
  }
  close() {
    this.generation++;
    this.worker?.close();
    this.worker = undefined;
    this.boot = undefined;
    this.update({ status: "closed", chainID: undefined });
  }
  setMode(mode: "anonymous" | "direct") {
    this.close();
    this.update({
      mode,
      status: "idle",
      error: undefined,
      latencyMS: undefined,
      readyMS: undefined,
    });
  }
  private async json(fetcher: typeof fetch, method: string, params: unknown[]) {
    const response = await fetcher(DESTINATION, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const body = await response.json();
    if (body.error || !Object.hasOwn(body, "result"))
      throw new Error(
        body.error
          ? `RPC error ${body.error.code}: ${String(body.error.message).slice(0, 180)}`
          : "Invalid RPC response",
      );
    return body.result as unknown;
  }
  async connect() {
    if (this.state.status === "ready") return;
    if (this.state.status === "failed")
      throw new Error("Transport failed. Reconnect explicitly to retry.");
    if (this.boot) return this.boot;
    const generation = this.generation,
      started = performance.now();
    this.update({ status: "starting", error: undefined });
    this.boot = (async () => {
      if (this.state.mode === "direct") {
        const chain = await this.json(this.direct, "eth_chainId", []);
        if (chain !== "0xaa36a7")
          throw new Error("Destination chain is not Sepolia");
        if (generation === this.generation) this.update({ chainID: chain });
      } else {
        // Bootstrap requests may ONLY discover the Sepolia specifier, never
        // provide a fallback for investigation queries.
        const provider = {
          request: async ({
            method,
            params,
          }: {
            method: string;
            params?: unknown[] | Record<string, unknown>;
          }) => {
            const args = Array.isArray(params) ? params : [];
            const call = args[0] as { to?: string } | undefined;
            if (
              method !== "eth_call" ||
              call?.to?.toLowerCase() !== SPECIFIER.toLowerCase()
            )
              throw new Error("Bootstrap is restricted to the Nox specifier");
            this.update({ bootstrapReads: this.state.bootstrapReads + 1 });
            this.log("Direct bootstrap: Nox specifier eth_call");
            return this.json(this.direct, method, args);
          },
        };
        const worker = await this.create({
          address: SPECIFIER,
          preExisting: { rpcProvider: provider },
        });
        if (generation !== this.generation) {
          worker.close();
          throw new Error("Connection closed");
        }
        this.worker = worker;
        if (worker.acceptLog) void this.collectLogs(worker, generation);
        await deadline(worker.ready, this.timeout);
        const chain = await deadline(
          this.json(worker.fetch, "eth_chainId", []),
          this.timeout,
        );
        if (chain !== "0xaa36a7")
          throw new Error("Anonymous destination chain is not Sepolia");
        if (generation === this.generation) this.update({ chainID: chain });
      }
      if (generation !== this.generation) throw new Error("Connection closed");
      this.update({
        status: "ready",
        readyMS: Math.round(performance.now() - started),
      });
      this.log(
        this.state.mode === "anonymous"
          ? "Nox ready; destination chain verified through worker"
          : "Direct RPC ready — source IP exposed",
      );
    })().catch((error) => {
      if (generation === this.generation) {
        this.worker?.close();
        this.worker = undefined;
        this.update({
          status: "failed",
          error: error instanceof Error ? error.message : "Transport failed",
        });
      }
      throw error;
    });
    return this.boot;
  }
  private async collectLogs(worker: Worker, generation: number) {
    try {
      while (generation === this.generation && worker.acceptLog) {
        const entry = await worker.acceptLog();
        if (generation !== this.generation) return;
        this.log(
          entry.args
            .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
            .join(" ")
            .slice(0, 450),
        );
      }
    } catch {
      /* Worker readiness/request promises report failures. Closing drains logs. */
    }
  }
  async testWorkerFailure() {
    if (
      this.state.mode !== "anonymous" ||
      this.state.status !== "ready" ||
      !this.worker
    )
      throw new Error("Connect Nox before running the failure check");
    this.log("Failure check: worker closed before an execution read");
    this.worker.close();
    return this.request("eth_chainId", []);
  }
  async request(method: string, params: unknown[]) {
    if (!READ_METHODS.has(method))
      throw new Error("Only supported execution read methods are allowed");
    await this.connect();
    const generation = this.generation,
      started = performance.now();
    try {
      const fetcher =
        this.state.mode === "anonymous" ? this.worker?.fetch : this.direct;
      if (!fetcher) throw new Error("Anonymizing worker unavailable");
      const result = await deadline(
        this.json(fetcher, method, params),
        this.timeout,
      );
      if (generation !== this.generation)
        throw new Error("Transport changed during request");
      this.update({
        latencyMS: Math.round(performance.now() - started),
        requests: this.state.requests + 1,
      });
      this.log(`${method} completed via ${this.state.mode}`);
      return result;
    } catch (error) {
      if (generation === this.generation) {
        this.worker?.close();
        this.worker = undefined;
        this.update({
          status: "failed",
          error: error instanceof Error ? error.message : "RPC request failed",
        });
      }
      throw error;
    }
  }
}
