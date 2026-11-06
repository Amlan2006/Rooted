import type { ReactNode } from "react";
import { Section } from "@/components/ui/section";
import { SourceLine } from "@/components/ui/mono";
import { Stagger, StaggerItem } from "@/components/reveal";
import { Check } from "@/components/bento/panel";
import { analyst } from "@/components/analyst/data";
import { heroBlock } from "@/lib/data";
import { capturedOn, num, shortHash } from "@/lib/format";
import { cx } from "@/lib/cx";
import s from "@/components/s3-tape-how-terminal/how.module.css";

// Hand-drawn 16 px glyphs on one grid: 1.5 stroke, round joins, optically centred.
const icon = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const icons = {
  node: (
    <svg {...icon}>
      <rect x="2.25" y="2.25" width="11.5" height="5" rx="1.5" />
      <rect x="2.25" y="8.75" width="11.5" height="5" rx="1.5" />
      <path d="M5 4.75h.01M5 11.25h.01" />
    </svg>
  ),
  verify: (
    <svg {...icon}>
      <path d="M8 1.75 13 3.6v3.85c0 3.05-2.05 5.3-5 6.8-2.95-1.5-5-3.75-5-6.8V3.6Z" />
      <path d="m5.85 8 1.5 1.5 2.8-3" />
    </svg>
  ),
  store: (
    <svg {...icon}>
      <ellipse cx="8" cy="3.75" rx="5.25" ry="1.75" />
      <path d="M2.75 3.75v8.5c0 .97 2.35 1.75 5.25 1.75s5.25-.78 5.25-1.75v-8.5M2.75 8c0 .97 2.35 1.75 5.25 1.75S13.25 8.97 13.25 8" />
    </svg>
  ),
  explain: (
    <svg {...icon}>
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2" />
      <path d="M5.5 10.5V8.75M8 10.5v-5M10.5 10.5V7.25" />
    </svg>
  ),
};

type Artefact = { title: ReactNode; meta?: ReactNode; rows: [key: string, value: ReactNode][] };
type Stage = { name: string; meta: string; icon: ReactNode; body: ReactNode; artefact: Artefact };

const b = heroBlock;
const report = analyst.evidence[0];
const sha = (hex: string) => `${hex.slice(0, 6)}…${hex.slice(-4)}`;

// Claims restate README.md, docs/BACKEND.md (Evidence semantics), docs/EXECUTION_PROFILER.md (Rerun saved capture),
// docs/XRAY.md, docs/API.md and docs/X402_HOSTED.md. Each artefact is a real value from data/*.json: the hero block as
// read and verified (hero-block.json), then the X-ray report and the brief that cites it (analyst.json).
const stages: Stage[] = [
  {
    name: "Your node",
    meta: "Geth + Nimbus",
    icon: icons.node,
    body: "Rooted reads a Nimbus beacon node and a Geth execution node that you run, and checks their genesis and chain ID before it trusts either.",
    artefact: {
      title: <>Block {num(b.number)}</>,
      meta: `${b.time.slice(11, 19)} UTC`,
      rows: [
        ["Geth receipts", num(b.tx_count)],
        ["Nimbus envelope", `${num(b.access_list.bytes)} B`],
      ],
    },
  },
  {
    name: "Verify",
    meta: "every slot",
    icon: icons.verify,
    body: (
      <>
        Each slot resolves to its beacon root. Envelope and block are fetched by the committed payload hash and must agree, and the{" "}
        <b>access list</b> commitment is recomputed.
      </>
    ),
    artefact: {
      title: <>Slot {b.slot !== null ? num(b.slot) : "n/a"}</>,
      meta: b.access_list.commitment_matches ? (
        <span className="inline-flex items-center gap-1 text-acc">
          <Check />
          match
        </span>
      ) : (
        "no match"
      ),
      rows: [
        ["beacon root", b.beacon_root ? shortHash(b.beacon_root) : "n/a"],
        ["BAL hash", b.block_access_list_hash ? shortHash(b.block_access_list_hash) : "n/a"],
      ],
    },
  },
  {
    name: "Store",
    meta: "Postgres",
    icon: icons.store,
    body: (
      <>
        Every snapshot keeps the raw responses behind it by digest, and every replay keeps its capture, so a block can be{" "}
        <b>
          <span className="whitespace-nowrap">X-rayed</span> again offline
        </b>
        .
      </>
    ),
    artefact: {
      title: <>X-ray {num(analyst.block_number)}</>,
      meta: `${report.at.slice(11, 19)} UTC`,
      rows: [
        ["kind", `${report.kind} report`],
        ["sha256", sha(report.sha256)],
      ],
    },
  },
  {
    name: "Explain",
    meta: "dashboard · API · Analyst",
    icon: icons.explain,
    body: (
      <>
        The same evidence reaches the dashboard, the REST API and the Analyst, and is sold per report over <b>x402</b>. What was not measured
        stays null, with the reason written down.
      </>
    ),
    artefact: {
      title: <>Brief {num(analyst.block_number)}</>,
      meta: `HCS #${analyst.hcs.sequence}`,
      rows: [
        // The brief cites the stored report by the same digest: the two cards share a value.
        [`cites ${report.id}`, sha(report.sha256)],
        ["sha256", sha(analyst.hcs.brief_sha256)],
      ],
    },
  },
];

/** The artefact a stage leaves: a crop of the record it writes, in the dashboard's card style. */
function Card({ a }: { a: Artefact }) {
  return (
    <div className="rounded-card border border-line bg-surface-1 font-mono text-[12px] leading-4 shadow-raised">
      <div className="flex h-8 items-center justify-between gap-3 border-b px-3">
        <span className="whitespace-nowrap text-fg">{a.title}</span>
        {a.meta && <span className="whitespace-nowrap text-[11px] text-fg-3">{a.meta}</span>}
      </div>
      <dl className="px-3 py-1.5">
        {a.rows.map(([k, v]) => (
          <div key={k} className="flex h-6 items-center justify-between gap-3">
            <dt className="whitespace-nowrap text-fg-3">{k}</dt>
            <dd className="whitespace-nowrap text-fg-2">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The chevron on the hairline between two stages, at the artefacts' height: across from lg, down while stacked. */
function Junction() {
  return (
    <span aria-hidden="true" className={cx(s.junction, "absolute z-10 grid size-5 place-items-center rounded-full border border-line-strong bg-bg text-fg-3")}>
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="rotate-90 lg:rotate-0">
        <path d="M3 1.5 5.5 4 3 6.5" />
      </svg>
    </span>
  );
}

export function How() {
  return (
    <Section
      id="how-it-works"
      size="sm"
      title="From your node to an answer."
      lead="Four stages, and each one leaves a record you can check. These are real ones, from Rooted’s node and its Analyst."
    >
      {/* Hairlines are the 1px gaps over opaque cells (as in the bento). Stacked below lg, with the artefact beside the copy from md. */}
      <Stagger as="ol" gap={0.12} className="grid gap-px overflow-hidden rounded-window border bg-line bg-clip-padding lg:grid-cols-4">
        {stages.map((st, i) => (
          <StaggerItem
            as="li"
            key={st.name}
            className="relative flex flex-col gap-5 bg-bg p-5 sm:p-6 md:grid md:grid-cols-[minmax(0,1fr)_260px] md:items-end md:gap-10 lg:flex lg:items-stretch lg:gap-6"
          >
            <div>
              {/* Meta sits right after the name while stacked, never pushed to the far edge; in the narrow columns from lg it
                  takes its own line under the name, so every column's copy starts at the same height. */}
              <h3 className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[16px] font-medium leading-6 tracking-[-0.015em] text-fg">
                <span className="text-fg-2">{st.icon}</span>
                {st.name}
                <span className="font-mono text-[12px] font-normal tracking-normal text-fg-3 lg:basis-full lg:pl-[26px]">{st.meta}</span>
              </h3>
              <p className="mt-3 max-w-[52ch] text-[15px] leading-[1.6] text-fg-2">{st.body}</p>
            </div>
            <div className="lg:mt-auto">
              <Card a={st.artefact} />
            </div>
            {i < stages.length - 1 && <Junction />}
          </StaggerItem>
        ))}
      </Stagger>
      <SourceLine
        className="mt-4"
        data={{
          source: `Block ${num(b.number)} from Rooted’s Sepolia node; X-ray and brief for block ${num(analyst.block_number)} from the dashboard and Hedera testnet`,
          captured_at: capturedOn(analyst.captured_at) > capturedOn(b.captured_at) ? analyst.captured_at : b.captured_at,
        }}
      />
    </Section>
  );
}
