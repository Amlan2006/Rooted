import type { ReactNode } from "react";
import { epbs, heroBlock, links, meta, pricing } from "@/lib/data";
import { num, shortHash } from "@/lib/format";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { SourceLine } from "@/components/ui/mono";
import { CopyButton } from "@/components/ui/copy-button";
import { ArrowUpRight } from "@/components/ui/icons";
import { Tabs } from "@/components/s3-tape-how-terminal/tabs";
import { x402Docs } from "@/components/s4-pricing-faq/docs";

// Commands come from README.md (quick start), docs/BACKEND.md (Use), cmd/rooted/main.go and the routes in
// internal/api/server.go; the agent exchange follows dashboard/lib/x402.ts and docs/X402_HOSTED.md, all on main.
// CLI and API use the hero block. The agent shows the first call an agent really paid for (HCS audit topic, message
// 1, settled SUCCESS on the mirror node). A paid call for the hero block would get a 404: our node no longer has the
// state to X-ray it, so there is no stored report to sell.
const slot = heroBlock.slot ?? epbs.slot;
const hash = heroBlock.hash;
const stored = pricing.stored_report;
const api = "http://127.0.0.1:8080";

// Line grammar: "$ " command, "# " comment, "> " / "< " sent / received HTTP, anything else is output.
const cli = [
  "# point ROOTED_EXECUTION_URL / ROOTED_BEACON_URL at your node",
  "$ cp .env.example .env",
  "$ set -a; . ./.env; set +a",
  "$ docker compose --project-name rooted up -d --wait postgres",
  "$ go build -o .tools/rooted ./cmd/rooted",
  "",
  "# snapshot one slot, then decode one block's access list",
  `$ .tools/rooted ingest ${slot}`,
  `$ .tools/rooted analyze ${hash}`,
  "",
  "# API, collectors and the live feed on 127.0.0.1:8080",
  "$ .tools/rooted serve",
];

const http = [
  "# database reachability, not provider health",
  `$ curl -sS ${api}/health`,
  '{"status":"ok","network":"sepolia"}',
  "",
  "# snapshot a slot into Postgres, then read it back",
  `$ curl -sS -X POST '${api}/api/v1/slots/${slot}/ingest?network=sepolia'`,
  `$ curl -sS '${api}/api/v1/slots/${slot}?network=sepolia'`,
  "",
  "# PayloadWatch journal as server-sent events",
  `$ curl -N '${api}/api/v1/live?network=sepolia'`,
];

// x402 v2 headers carry base64 JSON; the prefixes shown are the real encodings of the decoded lines below them.
const b64 = (value: object) => `${btoa(JSON.stringify(value)).slice(0, 22)}…`;
const offer = { x402Version: 2, accepts: [{ scheme: pricing.scheme, network: pricing.network, ...(pricing.price && { amount: pricing.price.amount_atomic }), asset: pricing.asset }] };
const offerJson = JSON.stringify(offer.accepts[0]).slice(1, -1);
const paidHash = stored?.block_hash ?? hash;
const paidPath = (pricing.route ?? "/api/paid/xray/[hash]").replace("[hash]", shortHash(paidHash));
// Without a recorded settlement the example stops at the signed retry: it never shows a 200 that did not happen.
const settled = stored && { success: true, transaction: stored.payment_tx };
const agent = [
  `$ node agent.mjs ${paidHash}`,
  "",
  "# 1 · ask: no payment attached, so the route quotes its price",
  `> GET ${paidPath} HTTP/1.1`,
  "< HTTP/1.1 402 Payment Required",
  `< PAYMENT-REQUIRED: ${b64(offer)}`,
  '    {"x402Version":2,"accepts":[{',
  `      ${offerJson},…}]}`,
  "",
  "# 2 · pay: spend limits checked, Hedera transfer signed, request retried",
  `> GET ${paidPath} HTTP/1.1`,
  `> PAYMENT-SIGNATURE: ${b64({ x402Version: 2, accepted: offer.accepts[0] })}`,
  ...(settled
    ? [
        "",
        `# 3 · report found, so it settled: Hedera tx ${settled.transaction}`,
        "< HTTP/1.1 200 OK",
        `< PAYMENT-RESPONSE: ${b64(settled)}`,
        `    ${JSON.stringify(settled).slice(0, -1)},…}`,
        "< ",
        `{"data":{"schema":"rooted-xray-v1","block":{"hash":"${shortHash(paidHash)}",…}}}`,
      ]
    : []),
];

// A Hedera transaction id in a comment links to its HashScan page.
const hederaTx = /(0\.0\.\d+@\d+\.\d+)/;
const withTxLink = (text: string) =>
  text.split(hederaTx).map((part, i) =>
    i % 2 ? (
      <a key={i} href={`https://hashscan.io/testnet/transaction/${part}`} className="link">
        {part}
      </a>
    ) : (
      part
    ),
  );

const commands = (lines: string[]) =>
  lines
    .filter((l) => l.startsWith("$ ") || l.startsWith("# ") || l === "")
    .map((l) => l.replace(/^\$ /, ""))
    .join("\n")
    .trim();

// The prompt is drawn by CSS so it stays out of copied selections. Muted, not signal: signal marks only the capping tx.
const prompt = "before:mr-[1ch] before:text-muted before:content-['$']";

function Line({ line }: { line: string }) {
  if (line.startsWith("$ "))
    return (
      <span className={prompt}>
        {line
          .slice(2)
          .split(/(\s+)/)
          .map((t, i) =>
            /^[-+][a-zA-Z-]/.test(t) ? (
              <span key={i} className="text-muted">
                {t}
              </span>
            ) : (
              t
            ),
          )}
      </span>
    );
  if (/^[<>] /.test(line)) {
    const [, mark, rest] = line.match(/^([<>]) (.*)$/)!;
    const header = rest.match(/^([A-Za-z-]+): (.*)$/);
    return (
      <>
        <span className="select-none text-muted">{mark} </span>
        {header ? (
          <>
            {header[1]}: <span className="text-muted">{header[2]}</span>
          </>
        ) : (
          rest
        )}
      </>
    );
  }
  return <span className="text-muted">{line.startsWith("# ") ? withTxLink(line) : line}</span>;
}

function Code({ title, lines, copy, copyLabel }: { title: string; lines: string[]; copy: string; copyLabel: string }) {
  return (
    <div className="overflow-hidden rounded-panel border bg-paper-2">
      <div className="flex h-11 items-center justify-between border-b pl-4 pr-2 md:pl-5">
        <p className="font-mono text-label uppercase text-muted">{title}</p>
        <CopyButton value={copy} label={copyLabel} />
      </div>
      <pre tabIndex={0} role="region" aria-label={`${title} example`} className="overflow-x-auto px-4 py-5 font-mono text-[13px] leading-[22px] text-ink outline-offset-[-2px] focus-visible:outline-ink md:px-5">
        <code>
          {lines.map((line, i) => (
            <span key={i}>
              <Line line={line} />
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

function Notes({ children, href, link }: { children: ReactNode; href?: string; link?: string }) {
  return (
    <div className="max-w-[62ch] space-y-4 text-muted lg:pt-3">
      {children}
      {href && (
        <p>
          <a href={href} className="link inline-flex items-center gap-1 py-0.5">
            {link}
            <ArrowUpRight className="text-muted" />
          </a>
        </p>
      )}
    </div>
  );
}

const C = ({ children }: { children: ReactNode }) => <code className="font-mono text-[13px] text-ink">{children}</code>;

function Panel({ code, notes }: { code: ReactNode; notes: ReactNode }) {
  return (
    <div className="grid grid-cols-12 gap-x-6 gap-y-8">
      <div className="col-span-12 min-w-0 lg:col-span-8">{code}</div>
      <div className="col-span-12 lg:col-span-4">{notes}</div>
    </div>
  );
}

const tabs = [
  {
    id: "cli",
    label: "CLI",
    panel: (
      <Panel
        code={<Code title="Shell" lines={cli} copy={commands(cli)} copyLabel="Copy shell commands" />}
        notes={
          <Notes href={links.doc("docs/BACKEND.md")} link="Backend guide">
            <p>
              Needs Go {meta.go_version.split(".").slice(0, 2).join(".")}+ and Docker for Postgres; the dashboard adds Node {meta.node_version}. The Go process reads exported variables and never loads <C>.env</C> on its own.
            </p>
            <p>
              Commands apply the embedded migrations before they touch the database. <C>serve</C> then opens the API and starts the collectors; SIGINT drains it cleanly.
            </p>
          </Notes>
        }
      />
    ),
  },
  {
    id: "api",
    label: "API",
    panel: (
      <Panel
        code={<Code title="HTTP" lines={http} copy={commands(http)} copyLabel="Copy curl commands" />}
        notes={
          <Notes href={links.doc("docs/API.md")} link="API reference">
            <p>
              Slot routes take <C>network=sepolia</C> explicitly. Ingesting writes Rooted’s database, never the chain.
            </p>
            <p>
              The live feed resumes from <C>Last-Event-ID</C> after a disconnect. There is no authentication, so keep the API on loopback or a network you trust.
            </p>
          </Notes>
        }
      />
    ),
  },
  {
    id: "agent",
    label: "Agent",
    panel: (
      <Panel
        code={<Code title="x402 over HTTP" lines={agent} copy={agent[0].slice(2)} copyLabel="Copy agent command" />}
        notes={
          <Notes href={x402Docs} link="x402 guide">
            <p className="flex items-center gap-3 text-ink">
              Hosted mode <Badge>{pricing.testnet ? "testnet" : pricing.network}</Badge>
            </p>
            <p>
              {pricing.price ? (
                <>
                  An agent pays <C>{pricing.price.display}</C> {pricing.price.unit} over x402, settled on Hedera with no human approval.
                </>
              ) : (
                "Priced per request in the 402 response, settled on Hedera over x402 with no human approval."
              )}
            </p>
            <p>The facilitator settles only after the report is found, so a 404 or a backend error is never charged. The paywall is off unless an operator turns it on.</p>
            <SourceLine data={pricing} />
            {stored && <SourceLine data={{ source: `Block ${num(stored.block_number)}: ${stored.source}`, captured_at: pricing.captured_at }} />}
          </Notes>
        }
      />
    ),
  },
];

export function Terminal() {
  return (
    <Section
      id="use"
      index={5}
      eyebrow="Use it"
      title="Run it, curl it, or let an agent pay."
      intro={
        <>
          Every command here is taken from the repo’s docs. The CLI and API commands point at the hero block above; the agent exchange follows the first
          call an agent actually paid for.
        </>
      }
      compact
    >
      <Tabs label="Ways to use Rooted" tabs={tabs} />
    </Section>
  );
}
