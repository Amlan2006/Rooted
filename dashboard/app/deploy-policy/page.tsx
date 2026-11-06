"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, ShieldCheck, Wallet } from "lucide-react";
import {
  Deployment,
  formatTestETH,
  validateDeployment,
} from "@/lib/policy-deployment";
import { Badge, Evidence, Panel } from "@/components/ui";
type Provider = {
  request(input: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: () => void): void;
  removeListener?(event: string, listener: () => void): void;
};
type WalletChoice = {
  info: { uuid: string; name: string };
  provider: Provider;
};
export default function DeployPolicy() {
  const [prepared, setPrepared] = useState<Deployment>();
  const [wallets, setWallets] = useState<WalletChoice[]>([]);
  const [choice, setChoice] = useState("");
  const [account, setAccount] = useState("");
  const [chain, setChain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hash, setHash] = useState("");
  const provider = wallets.find((w) => w.info.uuid === choice)?.provider;
  useEffect(() => {
    let alive = true;
    fetch("/api/policy-deployment", { cache: "no-store" })
      .then(async (r) => {
        const p = await r.json();
        if (!r.ok)
          throw new Error(p.error?.message || "Preparation unavailable");
        validateDeployment(p);
        if (alive) setPrepared(p);
      })
      .catch((e) => {
        if (alive)
          setError(e instanceof Error ? e.message : "Preparation unavailable");
      });
    const announce = (event: Event) => {
      const detail = (event as CustomEvent<WalletChoice>).detail;
      if (!detail?.provider?.request || !detail.info?.uuid) return;
      setWallets((list) =>
        list.some((w) => w.info.uuid === detail.info.uuid)
          ? list
          : [...list, detail],
      );
      setChoice((current) => current || detail.info.uuid);
    };
    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const injected = (window as unknown as { ethereum?: Provider }).ethereum;
    if (injected) {
      setWallets((list) =>
        list.length
          ? list
          : [
              {
                info: { uuid: "injected", name: "Browser wallet" },
                provider: injected,
              },
            ],
      );
      setChoice((current) => current || "injected");
    }
    return () => {
      alive = false;
      window.removeEventListener("eip6963:announceProvider", announce);
    };
  }, []);
  useEffect(() => {
    if (!provider) return;
    const reset = () => {
      setAccount("");
      setChain("");
    };
    provider.on?.("accountsChanged", reset);
    provider.on?.("chainChanged", reset);
    return () => {
      provider.removeListener?.("accountsChanged", reset);
      provider.removeListener?.("chainChanged", reset);
    };
  }, [provider]);
  async function connected() {
    if (!provider || !prepared)
      throw new Error("Open this page in a wallet-enabled browser");
    const accounts = (await provider.request({
      method: "eth_requestAccounts",
    })) as string[];
    const network = (await provider.request({
      method: "eth_chainId",
    })) as string;
    setAccount(accounts[0] || "");
    setChain(network);
    if (accounts[0]?.toLowerCase() !== prepared.expected_sender)
      throw new Error("Select the prepared funded account in your wallet");
    if (network !== "0xaa36a7")
      throw new Error("Switch your wallet to Sepolia before deploying");
  }
  function message(e: unknown) {
    const object = e as { code?: number; message?: string };
    return object.code === 4001
      ? "Wallet request cancelled. No transaction was approved."
      : object.code
        ? `Wallet request failed (code ${object.code}). Check the selected account and network.`
        : object.message || "Wallet request failed";
  }
  async function connect() {
    setBusy(true);
    setError("");
    try {
      await connected();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function switchChain() {
    if (!provider) return;
    setBusy(true);
    setError("");
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xaa36a7" }],
      });
      await connected();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function deploy() {
    if (!provider || !prepared) return;
    setBusy(true);
    setError("");
    try {
      validateDeployment(prepared);
      const accounts = (await provider.request({
        method: "eth_accounts",
      })) as string[];
      const network = await provider.request({ method: "eth_chainId" });
      if (
        network !== "0xaa36a7" ||
        accounts[0]?.toLowerCase() !== prepared.expected_sender
      )
        throw new Error(
          "Wallet account or network changed. Reconnect before deploying.",
        );
      const nonce = (await provider.request({
        method: "eth_getTransactionCount",
        params: [prepared.expected_sender, "pending"],
      })) as string;
      if (BigInt(nonce) !== BigInt(prepared.transaction.nonce))
        throw new Error(
          "The account nonce changed. Refresh the unsigned preparation before deploying.",
        );
      const value = await provider.request({
        method: "eth_sendTransaction",
        params: [prepared.transaction],
      });
      if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value))
        throw new Error("Wallet did not return a transaction hash");
      setHash(value);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const ready =
    prepared &&
    account.toLowerCase() === prepared.expected_sender &&
    chain === "0xaa36a7" &&
    prepared.sufficient_test_balance;
  return (
    <main className="deployment-page">
      <a href="/?view=incidents" className="text-button">
        <ArrowLeft size={15} />
        Back to Rooted
      </a>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PHASE 7 / PUBLIC POLICY</span>
          <h1>
            Review policy deployment
          </h1>
          <p>
            One immutable contract on Sepolia. Signing stays inside your wallet.
          </p>
        </div>
        <Badge tone="blue">SEPOLIA · 11155111</Badge>
      </div>
      <Panel
        title="Deployment review"
        subtitle="Contract creation · value 0 ETH"
      >
        <div className="cre-context">
          <ShieldCheck size={20} />
          <div>
            <strong>Your wallet handles approval and signing.</strong>
            <p>
              This page never asks for a private key or seed phrase. Connecting
              does not deploy anything. Deployment is sent only after you click
              the deployment button and approve in your wallet.
            </p>
          </div>
        </div>
        {prepared && (
          <>
            <div className="fact-grid">
              <div>
                <span>Expected funded account</span>
                <strong className="wrap-code">
                  {prepared.expected_sender}
                </strong>
              </div>
              <div>
                <span>Contract</span>
                <strong>{prepared.contract_name}</strong>
              </div>
              <div>
                <span>Maximum fee at prepared gas bounds</span>
                <strong>
                  {formatTestETH(prepared.maximum_fee_wei)} Sepolia ETH
                </strong>
              </div>
              <div>
                <span>Gas limit</span>
                <strong>{prepared.gas_limit.toLocaleString()}</strong>
              </div>
              <div>
                <span>Reveal latency threshold</span>
                <strong>
                  {prepared.policy_values.max_reveal_latency_ms} ms
                </strong>
              </div>
              <div>
                <span>Maximum missing payloads</span>
                <strong>{prepared.policy_values.max_missing_payloads}</strong>
              </div>
              <div>
                <span>Maximum summary / observation age</span>
                <strong>
                  {prepared.policy_values.max_summary_age_seconds} /{" "}
                  {prepared.policy_values.max_observation_age_seconds} seconds
                </strong>
              </div>
              <div>
                <span>Minimum observations / timed samples</span>
                <strong>
                  {prepared.policy_values.min_observations} /{" "}
                  {prepared.policy_values.min_timed_samples}
                </strong>
              </div>
              <div>
                <span>Monitored scope</span>
                <strong>Sepolia · live observations</strong>
              </div>
            </div>
            <p className="footnote">
              Gas and account state were checked at block{" "}
              {parseInt(prepared.prepared_at_block, 16).toLocaleString()}. Fees
              use Sepolia test ETH. No contract payment or token approval is
              requested. Wallet connection and deployment traffic use your
              wallet/provider, separately from the Nox investigation transport.
            </p>
            {!prepared.sufficient_test_balance && (
              <div className="notice warning">
                The checked wallet balance is below the prepared maximum gas
                fee. Deployment is disabled.
              </div>
            )}
          </>
        )}
        <div className="form">
          <label htmlFor="deployment-wallet">Browser wallet</label>
          {wallets.length ? (
            <select
              id="deployment-wallet"
              value={choice}
              onChange={(e) => {
                setChoice(e.target.value);
                setAccount("");
                setChain("");
              }}
            >
              {wallets.map((wallet) => (
                <option key={wallet.info.uuid} value={wallet.info.uuid}>
                  {wallet.info.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="notice">
              No wallet detected. Open this page in your wallet-enabled desktop
              browser.
            </div>
          )}
          <div className="button-row">
            <button
              onClick={() => void connect()}
              disabled={!provider || !prepared || busy}
            >
              <Wallet size={16} />
              {busy ? "Waiting for wallet…" : "Connect wallet"}
            </button>
            {account && chain !== "0xaa36a7" && (
              <button onClick={() => void switchChain()} disabled={busy}>
                Switch to Sepolia
              </button>
            )}
            <button
              className="primary"
              onClick={() => void deploy()}
              disabled={!ready || busy || !!hash}
            >
              Deploy policy on Sepolia
            </button>
          </div>
          {account && (
            <p className="small muted">
              Connected account: {account} · chain{" "}
              {chain === "0xaa36a7" ? "Sepolia" : chain || "unknown"}
            </p>
          )}
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          {hash && (
            <div className="deployment-receipt">
              <h3>Transaction submitted</h3>
              <p>
                Send this transaction hash back in the chat. The assistant can
                verify the receipt, register the public policy, and run CRE
                against it.
              </p>
              <code>{hash}</code>
              <a
                href={"https://sepolia.etherscan.io/tx/" + hash}
                target="_blank"
                rel="noreferrer"
              >
                View on Sepolia Etherscan
              </a>
            </div>
          )}
        </div>
        <div className="panel-footer">
          <span>Unsigned preparation only until your wallet approves.</span>
          {prepared && (
            <Evidence
              value={prepared.transaction}
              label="Unsigned transaction"
            />
          )}
        </div>
      </Panel>
    </main>
  );
}
