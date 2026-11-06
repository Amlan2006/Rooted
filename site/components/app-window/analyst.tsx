import { useState, type CSSProperties } from "react";
import { cx } from "@/lib/cx";
import { num, nums } from "@/lib/format";
import type { Brief } from "./types";
import { IconCheck } from "./icons";
import { Card, CardHead, Chip, ViewHead } from "./ui";
import s from "./anim.module.css";

const utc = (iso: string) => `${iso.slice(11, 16)} UTC`;
const trigger = (t: string) => t.replace(/_/g, " ");

/** Brief text with its [E1] citations as chips. */
function Cited({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[E\d+\])/).map((part, i) =>
        /^\[E\d+\]$/.test(part) ? (
          <span key={i} className="mx-0.5 inline-flex h-4 items-center rounded-[4px] border border-line-strong bg-fg/[0.04] px-1 align-[1px] font-mono text-[10px] leading-none text-fg-2">
            {part.slice(1, -1)}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function Analyst({ briefs }: { briefs: Brief[] }) {
  const [sel, setSel] = useState(0);
  const b = briefs[sel];
  const [lead, ...rest] = b.brief.split("\n");
  const bullets = rest.map((l) => l.replace(/^-\s*/, "")).filter(Boolean);

  return (
    <div className="flex h-full flex-col gap-4 p-4 @2xl:p-5">
      <ViewHead title="Analyst" sub="Briefs it writes on its own for blocks that trip a rule." aside={<Chip>{b.model}</Chip>} />
      <div className="grid min-h-0 flex-1 gap-4 @2xl:grid-cols-[232px_1fr]">
        <Card className="hidden min-h-0 flex-col overflow-hidden p-2 @2xl:flex">
          <CardHead title="Briefs" meta="recent" className="px-2 pb-2 pt-1.5" />
          <ul>
            {briefs.map((x, i) => (
              <li key={x.block_hash}>
                <button
                  type="button"
                  onClick={() => setSel(i)}
                  aria-pressed={i === sel}
                  className={cx(
                    "relative flex w-full flex-col gap-1 rounded-md px-2 py-2 text-left transition-colors duration-150",
                    i === sel ? "bg-fg/[0.06]" : "hover:bg-fg/[0.03]",
                  )}
                >
                  <span className="flex w-full items-baseline justify-between gap-2">
                    <span className={cx("font-mono text-[12.5px]", i === sel ? "text-fg" : "text-fg-2")}>{num(x.block_number)}</span>
                    {/* Selected rows sit on a lighter fill, so their small text steps up to fg-2 to keep AA contrast. */}
                    <span className={cx("font-mono text-[11px]", i === sel ? "text-fg-2" : "text-fg-3")}>{utc(x.created_at)}</span>
                  </span>
                  <span className={cx("flex gap-1 text-[11px] leading-4", i === sel ? "text-fg-2" : "text-fg-3")}>
                    {x.triggers.map((t) => (
                      <span key={t}>{trigger(t)}</span>
                    ))}
                  </span>
                  {i === sel && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-acc" />}
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card key={b.block_hash} className="flex min-h-0 flex-col overflow-hidden p-4 @2xl:p-5">
          <CardHead
            title={
              <>
                Block <span className="font-mono">{num(b.block_number)}</span>
              </>
            }
            meta={utc(b.created_at)}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {b.triggers.map((t) => (
              <Chip key={t}>{trigger(t)}</Chip>
            ))}
          </div>
          <p className={cx(s.stagger, "mt-3 text-[14px] leading-[22px] tracking-[-0.005em] text-fg")} style={{ "--i": 0 } as CSSProperties}>
            <Cited text={lead} />
          </p>
          <ul className="mt-2.5 space-y-2 text-[12.5px] leading-5 text-fg-2">
            {bullets.map((l, i) => (
              <li key={i} className={cx(s.stagger, "relative pl-3.5", i > 1 && "hidden @2xl:block")} style={{ "--i": i + 1 } as CSSProperties}>
                <span aria-hidden="true" className="absolute left-0 top-[9px] size-1 rounded-full bg-fg-4" />
                <Cited text={l} />
              </li>
            ))}
          </ul>
          <div className={cx(s.stagger, "mt-auto space-y-1.5 border-t pt-3 font-mono text-[11px] leading-4 text-fg-3")} style={{ "--i": bullets.length + 1 } as CSSProperties}>
            {/* Rows wrap rather than truncate: a cut label or price reads as a different one. */}
            {b.evidence.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="rounded-[4px] border border-line-strong px-1 text-fg-2">{e.id}</span>
                <span className="whitespace-nowrap">{nums(e.label)}</span>
                {b.payment?.report_sha256 === e.sha256 ? (
                  <span className="whitespace-nowrap">
                    · later sold over x402, <span className="text-fg-2">{b.payment.amount_tinybars / 1e8} HBAR</span>
                    {b.payment.result === "SUCCESS" && <IconCheck className="ml-1 inline align-[-1px] text-acc" />}
                  </span>
                ) : (
                  <span className="hidden whitespace-nowrap @2xl:inline">· sha256 {e.sha256.slice(0, 8)}…</span>
                )}
              </div>
            ))}
            {b.hcs && (
              <div className="hidden truncate @2xl:block">
                Published to Hedera HCS topic {b.hcs.topic}, message {b.hcs.sequence}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
