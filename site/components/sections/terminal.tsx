import type { ReactNode } from "react";
import { epbs, heroBlock, links, meta, pricing } from "@/lib/data";
import { num, shortHash } from "@/lib/format";
import { Section } from "@/components/ui/section";
import { Reveal } from "@/components/reveal";
import { Badge } from "@/components/ui/badge";
import { SourceLine } from "@/components/ui/mono";
import { ArrowUpRight } from "@/components/ui/icons";
import { TerminalTabs } from "@/components/s3-tape-how-terminal/tabs";
import { x402Docs } from "@/components/s4-pricing-faq/docs";
import t from "@/components/s3-tape-how-terminal/terminal.module.css";

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
// agent.mjs lives in integrations/x402-agent with its own dependencies and .env (docs/X402_HOSTED.md, Setup).
const agent = [
  "# once: npm ci and node setup.mjs --hcs, see docs/X402_HOSTED.md",
  "$ cd integrations/x402-agent",
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
        `{"data":{"schema":"rooted-xray-v1",…,"block":{"hash":"${shortHash(paidHash)}",…}}}`,
      ]
    : []),
];

// A Hedera transaction id in a comment links to its HashScan page.
const hederaTx = /(0\.0\.\d+@\d+\.\d+)/;
const withTxLink = (text: string) =>
  text.split(hederaTx).map((part, i) =>
    i % 2 ? (
      <a key={i} href={`https://hashscan.io/testnet/transaction/${part}`} className="link text-fg-2 hover:text-fg">
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

// Colour is sparse: commands fg, flags and output fg-2, comments fg-3; the accent only marks prompts and success.
// The prompt is drawn by CSS so it stays out of copied selections.
const prompt = "before:mr-[1ch] before:text-acc before:content-['$']";

function Line({ line }: { line: string }) {
  if (line.startsWith("$ "))
    return (
      <span className={`text-fg ${prompt}`}>
        {line
          .slice(2)
          .split(/(\s+)/)
          .map((t, i) =>
            /^[-+][a-zA-Z-]/.test(t) ? (
              <span key={i} className="text-fg-2">
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
    const status = rest.match(/^(HTTP\/1\.1) (2\d\d .*)$/);
    return (
      <>
        <span className="select-none text-fg-3">{mark} </span>
        {header ? (
          <>
            <span className="text-fg">{header[1]}:</span> <span className="text-fg-2">{header[2]}</span>
          </>
        ) : status ? (
          <span className="text-fg">
            {status[1]} <span className="text-acc">{status[2]}</span>
          </span>
        ) : (
          <span className="text-fg">{rest}</span>
        )}
      </>
    );
  }
  if (line.startsWith("# ")) return <span className="text-fg-3">{withTxLink(line)}</span>;
  return <span className="text-fg-2">{line}</span>;
}

// The pre's own fill (bg at 45% over the window's surface-1), so the end fade blends into it.
const preFill = "color-mix(in srgb, var(--bg) 45%, var(--surface-1))";

function Code({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="relative min-w-0">
    <pre
      tabIndex={0}
      role="region"
      aria-label={`${title} example`}
      className="overflow-x-auto px-4 py-5 font-mono text-[13px] leading-[22px] outline-offset-[-2px] [scrollbar-color:var(--line-strong)_transparent] [scrollbar-width:thin] md:px-5"
      style={{ background: preFill }}
    >
      <code>
        {lines.map((line, i) => (
          <span key={i} data-line="">
            <Line line={line} />
            {"\n"}
          </span>
        ))}
        <span data-line="" aria-hidden="true" className={prompt}>
          <span className={`${t.cursor} inline-block h-4 w-[7px] translate-y-[3px] bg-fg-2`} />
        </span>
      </code>
    </pre>
      {/* The fade sits over the end padding (a line that fits is never dimmed), inset 2 px so the focus ring stays whole. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-[2px] right-[2px] w-4" style={{ background: `linear-gradient(90deg, transparent, ${preFill})` }} />
    </div>
  );
}

const C = ({ children }: { children: ReactNode }) => <code className="font-mono text-[13px] text-fg">{children}</code>;

function Notes({ title, children, href, link }: { title: ReactNode; children: ReactNode; href: string; link: string }) {
  return (
    <aside className="flex flex-col gap-4 border-t p-5 text-sm leading-[22px] text-fg-2 md:p-6 lg:border-t-0 lg:border-l">
      <h3 data-note="" className="text-[15px] font-medium tracking-[-0.01em] text-fg">
        {title}
      </h3>
      {children}
      <p data-note="" className="pt-1 lg:mt-auto">
        <a href={href} className="group inline-flex items-center gap-1.5 font-medium text-fg transition-colors hover:text-fg-2">
          {link}
          <ArrowUpRight className="text-fg-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </a>
      </p>
    </aside>
  );
}

function Panel({ title, lines, notes }: { title: string; lines: string[]; notes: ReactNode }) {
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_320px]">
      <Code title={title} lines={lines} />
      {notes}
    </div>
  );
}

const tabs = [
  {
    id: "cli",
    label: "CLI",
    meta: "sh · repo root",
    copy: commands(cli),
    copyLabel: "Copy shell commands",
    panel: (
      <Panel
        title="Shell"
        lines={cli}
        notes={
          <Notes title="Build it and point it at your node." href={links.doc("docs/BACKEND.md")} link="Backend guide">
            <p data-note="">
              Needs <b>Go {meta.go_version.split(".").slice(0, 2).join(".")}+</b> and <b>Docker</b> for Postgres; the dashboard adds Node {meta.node_version}. The Go process reads exported variables and never loads <C>.env</C> on its own.
            </p>
            <p data-note="">
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
    meta: api.replace("http://", ""),
    copy: commands(http),
    copyLabel: "Copy curl commands",
    panel: (
      <Panel
        title="HTTP"
        lines={http}
        notes={
          <Notes title="Read the evidence over HTTP." href={links.doc("docs/API.md")} link="API reference">
            <p data-note="">
              Slot routes take <C>network=sepolia</C> explicitly. Ingesting writes Rooted’s database, never the chain.
            </p>
            <p data-note="">
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
    meta: `x402 · ${pricing.network ?? "hedera"}`,
    copy: commands(agent.slice(0, 3)),
    copyLabel: "Copy agent command",
    panel: (
      <Panel
        title="x402 over HTTP"
        lines={agent}
        notes={
          <Notes
            title={
              <span className="flex items-center gap-2.5">
                Let an agent pay. <Badge>{pricing.testnet ? "testnet" : pricing.network}</Badge>
              </span>
            }
            href={x402Docs}
            link="x402 guide"
          >
            <p data-note="">
              {pricing.price ? (
                <>
                  An agent pays <b className="num">{pricing.price.display}</b> {pricing.price.unit} over x402, settled on Hedera with no human approval.
                </>
              ) : (
                "Priced per request in the 402 response, settled on Hedera over x402 with no human approval."
              )}
            </p>
            <p data-note="">The facilitator settles only after the report is found, so a 404 or a backend error is never charged. The paywall is off unless an operator turns it on.</p>
            <div data-note="" className="border-t pt-4">
              <SourceLine data={{ source: `x402.ts @ ${meta.commit}${stored ? ` · HCS ${stored.hcs_topic} #${stored.hcs_sequence}` : ""}`, captured_at: pricing.captured_at }} />
            </div>
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
      size="md"
      title="One repo. Three ways in."
      aside={
        <p className="max-w-[46ch] text-[15px] leading-[1.55] text-fg-2 lg:pb-1">
          Run it from a shell, read it over HTTP, or let an agent pay for a report. Every command here is taken from the repo’s docs.
        </p>
      }
    >
      <Reveal delay={0.12}>
        <TerminalTabs label="Ways to use Rooted" tabs={tabs} />
        <SourceLine className="mt-4" data={{ source: `CLI and API examples use Sepolia block ${num(heroBlock.number)}, slot ${num(slot)}`, captured_at: heroBlock.captured_at }} />
      </Reveal>
    </Section>
  );
}
