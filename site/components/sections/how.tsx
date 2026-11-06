import { Section } from "@/components/ui/section";
import { ScrollLine } from "@/components/s3-tape-how-terminal/scroll-line";

// Each claim restates README.md and docs/BACKEND.md (Evidence semantics), docs/API.md and docs/BAL_ANALYZER.md.
// `xray --capture` is the README quick start's offline path (cmd/rooted/main.go usage); `replay` only imports demo events.
const steps = [
  {
    name: "Node",
    title: "Start at your own node.",
    body: "Rooted reads Sepolia from a Nimbus beacon node and a Geth execution node that you point it at. It checks the beacon genesis and the execution chain ID before it trusts a single response.",
    detail: ["ROOTED_BEACON_URL", "ROOTED_EXECUTION_URL"],
  },
  {
    name: "Verify",
    title: "Check every commitment.",
    body: "Each slot resolves to its immutable beacon root. The payload envelope and execution block are fetched by the committed payload hash and must agree on slot, root, builder, parent, number and state. Access lists are decoded and checked against the header’s commitment.",
    detail: ['"identifiers_matched": true'],
  },
  {
    name: "Store",
    title: "Keep the raw evidence.",
    body: "Snapshots and the raw responses behind them are written to Postgres together, deduplicated by digest. An older fetch can never overwrite a newer one, and a saved replay capture can be X-rayed again offline.",
    detail: ["rooted xray --capture CAPTURE.json.gz"],
  },
  {
    name: "Explain",
    title: "Explain it, or leave it null.",
    body: "The API and dashboard turn that evidence into PTC tallies, RAW/WAR/WAW dependency graphs, native Geth replay timings and provider diffs. What was not measured stays null, with the reason written down.",
    detail: ['"reveal_latency_ms": null'],
  },
];

export function How() {
  return (
    <Section
      id="how-it-works"
      index={4}
      eyebrow="How it works"
      split
      title="Node in, evidence out."
      intro="Four stages, and each one leaves something you can check yourself."
    >
      <ScrollLine>
        <ol className="divide-y border-y">
          {steps.map((step, i) => (
            <li key={step.name} className="relative flex gap-4 py-10 md:gap-6 md:py-12">
              {/* Paper behind the number interrupts the rail, so the numbers read as stops on one line. */}
              <span className="relative w-7 shrink-0 self-start bg-paper py-1 text-center font-mono text-label text-ink">{String(i + 1).padStart(2, "0")}</span>
              <div className="grid flex-1 gap-y-4 md:grid-cols-12 md:gap-x-6">
                <div className="md:col-span-5">
                  <p className="pt-1 font-mono text-label uppercase text-muted">{step.name}</p>
                  <h3 className="mt-3 font-serif text-h3">{step.title}</h3>
                </div>
                <div className="md:col-span-7 md:pt-1 lg:col-span-6 lg:col-start-7">
                  <p className="max-w-[60ch] text-muted">{step.body}</p>
                  <p className="mt-4 flex flex-wrap gap-2">
                    {step.detail.map((d) => (
                      <code key={d} className="rounded-[4px] border bg-paper-2 px-2 py-0.5 font-mono text-xs leading-5 text-ink">
                        {d}
                      </code>
                    ))}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </ScrollLine>
    </Section>
  );
}
