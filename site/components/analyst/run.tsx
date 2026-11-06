"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { inView } from "motion/react";
import { Window } from "@/components/ui/window";
import { LogoMark } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { ArrowUpRight } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { num, nums, shortHash } from "@/lib/format";
import anim from "@/components/app-window/anim.module.css";
import { analyst as a, hashscanTopic, hashscanTx, hbar, hms, paragraphs } from "./data";
import { ReceiptIcon, ReplayIcon, Status } from "./icons";

// Beats of the replay, in recorded order: the rule that fired, the tool call, the streamed answer, the HCS anchor.
// The x402 sale of the cited report is not one of them: it happened 20 s later, made by someone else.
const TRIGGER = 1, CALL = 2, CALLED = 3, ANSWER = 4, CITED = 5, ANCHOR = 6, ANCHORED = 7;
const FINAL = ANCHORED;
const TOTAL = paragraphs.reduce((n, p) => n + p.groups.flat().length, 0);
const step = a.steps[0];
const pay = a.payment;
const trigger = (t: string) => t.replace(/_/g, " ");

/**
 * The stored auto-brief, replayed once when scrolled into view: rule fired → tool call → answer streamed in word
 * chunks with [E#] chips → its sha256 anchored on HCS. Server HTML and reduced motion get the final state. While it
 * plays the window grows into a box held at its final height, so the page below never moves.
 */
export function AnalystRun() {
  const ref = useRef<HTMLDivElement>(null);
  const [beat, setBeat] = useState(FINAL);
  const [shown, setShown] = useState(TOTAL);
  const [run, setRun] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const [reserve, setReserve] = useState<number>();
  const measure = () => ref.current && setReserve(ref.current.offsetHeight);

  // Arm once, only if motion is allowed and the window was still below the fold at load (no flash of an empty
  // window). Position comes from IntersectionObserver entries, so hydration forces no layout; the final height is
  // read once the window is near the viewport (and rendered), just before it resets.
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let stop = () => {};
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.boundingClientRect.top < (e.rootBounds?.height ?? innerHeight)) return io.disconnect();
        if (!e.isIntersecting) return;
        io.disconnect();
        setReserve(el.offsetHeight);
        setBeat(0);
        setShown(0);
        stop = inView(el, () => {
          stop();
          setRun((n) => n + 1);
        }, { amount: 0.35 });
      },
      { rootMargin: "0px 0px 400px 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      stop();
    };
  }, []);

  useEffect(() => {
    if (!run) return;
    const timers: number[] = [];
    let t = 0;
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, (t += ms)));
    setBeat(0);
    setShown(0);
    at(320, () => setBeat(TRIGGER));
    at(650, () => setBeat(CALL));
    at(1100, () => setBeat(CALLED));
    at(450, () => setBeat(ANSWER));
    // Stream in uneven 1–3 word chunks, like model output.
    for (let n = 0, i = 0; n < TOTAL; i++) {
      const v = (n = Math.min(TOTAL, n + 1 + ((i * 7) % 3)));
      at(i ? 42 : 200, () => setShown(v));
    }
    at(380, () => setBeat(CITED));
    at(520, () => setBeat(ANCHOR));
    at(800, () => setBeat(ANCHORED));
    return () => timers.forEach(clearTimeout);
  }, [run]);

  const playing = run > 0 && beat < FINAL;
  const status = beat < CALLED ? `Calling ${step.tool}` : beat < CITED ? "Writing the brief" : beat < FINAL ? "Anchoring on Hedera" : null;
  const lit = (id: string) => active === id;
  let k = 0;

  return (
    <div ref={ref} style={{ minHeight: beat < FINAL ? reserve : undefined }}>
      <Window
        title={
          <span className="flex items-center gap-1.5">
            <span className="font-normal text-fg-3">Analyst</span>
            <span aria-hidden="true" className="text-fg-4">/</span>
            <span>Auto-brief</span>
          </span>
        }
        meta={
          <>
            <span className="max-[374px]:hidden">block </span>
            {num(a.block_number)}
          </>
        }
      >
        <div className="flex flex-col gap-4 p-4 sm:p-6" aria-busy={playing}>
          {/* 1. What started it: a rule, not a person. The briefs loop asks; nobody typed a question. */}
          {beat >= TRIGGER && (
            <div className={cx(anim.enter, "flex items-center gap-3 font-mono text-[12px] whitespace-nowrap text-fg-3")}>
              <span className="hidden h-px flex-1 bg-line sm:block" />
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden="true" className="size-1.5 shrink-0 rotate-45 rounded-[1px] bg-fg-2" />
                <span className="font-sans text-[13px] text-fg-2">Rule fired</span>
                {a.triggers.map((t) => (
                  <span key={t} className="text-fg">{trigger(t)}</span>
                ))}
                <span className="hidden sm:inline">· block {num(a.block_number)}</span>
              </span>
              <span className="h-px flex-1 bg-line" />
            </div>
          )}

          {/* 2. The tool call that produced E1. */}
          {beat >= CALL && (
            <div className={cx(anim.enter, "flex h-10 items-center gap-2.5 rounded-control border border-line bg-surface-2 px-3 font-mono text-[12px]")}>
              <Status state={beat >= CALLED ? "done" : "run"} />
              <span className="shrink-0 text-fg">{step.tool}</span>
              <span className="min-w-0 truncate text-fg-3 max-[374px]:hidden">
                <span className="hidden sm:inline">block_hash </span>
                <span className="text-fg-2" title={step.input.block_hash}>{shortHash(step.input.block_hash ?? "")}</span>
              </span>
              <span className={cx("ml-auto flex shrink-0 items-center gap-2.5 transition-opacity duration-200", beat >= CALLED ? "opacity-100" : "opacity-0")}>
                <Cite id={step.evidence} lit={lit(step.evidence)} onLight={setActive} />
                <time dateTime={step.at} className="hidden text-fg-3 sm:inline">{hms(step.at)}</time>
              </span>
            </div>
          )}

          {/* 3. The answer, streamed. Only what has streamed is in the DOM, so the window grows with it. */}
          {beat >= ANSWER && (
            <div className={anim.enter}>
              <div className="mb-2.5 flex items-center gap-2 text-[13px]">
                <LogoMark />
                <span className="font-medium text-fg">Rooted Analyst</span>
                <span className="font-mono text-[12px] text-fg-3">{a.model}</span>
                <time dateTime={a.created_at} className="ml-auto font-mono text-[12px] text-fg-3">{hms(a.created_at)}</time>
              </div>
              <div className="text-[14px] leading-[22px] text-fg-2">
                {paragraphs.map((p, pi) => {
                  const first = k;
                  const body = p.groups.map((group) => {
                    const words = group.map((tok) => {
                      const i = k++;
                      if (i >= shown) return null;
                      const caret = playing && i === shown - 1 && shown < TOTAL;
                      return (
                        <Fragment key={i}>
                          {"cite" in tok ? (
                            <Cite id={tok.cite} lit={lit(tok.cite)} onLight={setActive} />
                          ) : p.bullet && /\d/.test(tok.text) ? (
                            // Figures read brighter than the prose around them.
                            <span className="text-fg">{tok.text}</span>
                          ) : (
                            tok.text
                          )}
                          {caret && <span aria-hidden="true" className="-mr-[2px] inline-block h-[15px] w-[2px] translate-y-[3px] bg-fg-2" />}
                        </Fragment>
                      );
                    });
                    return group.length > 1 ? <span key={`g${k}`} className="whitespace-nowrap">{words}</span> : <Fragment key={`g${k}`}>{words[0]}</Fragment>;
                  });
                  if (first >= shown) return null;
                  if (!p.bullet) return <p key={pi} className="mb-2 font-medium text-fg">{body}</p>;
                  return (
                    <p key={pi} className="relative mt-1.5 pl-4">
                      <span aria-hidden="true" className="absolute top-[9px] left-[3px] size-1 rounded-full bg-fg-4" />
                      {body}
                    </p>
                  );
                })}
              </div>
            </div>
          )}

          {/* 4. Evidence the chips point at. */}
          {beat >= CITED &&
            a.evidence.map((e) => (
              <div
                key={e.id}
                id={`analyst-${e.id}`}
                className={cx(
                  anim.enter,
                  // Wraps to two lines on phones rather than cut the label or the digest.
                  "flex min-h-10 flex-wrap items-center gap-x-2.5 gap-y-1 rounded-control border px-3 py-2 text-[13px] transition-colors duration-200",
                  lit(e.id) ? "border-acc/40 bg-acc/[0.06]" : "border-line bg-surface-2",
                )}
              >
                <EvidenceId id={e.id} lit={lit(e.id)} />
                <span className="text-fg">{nums(e.label)}</span>
                <span className="hidden font-mono text-[12px] text-fg-3 lg:inline">{e.kind}</span>
                <span className="ml-auto shrink-0 font-mono text-[12px] text-fg-3">
                  <span className="hidden sm:inline">sha256 </span>
                  <span className={cx("transition-colors duration-200", lit(e.id) ? "text-acc" : "text-fg-2")}>{shortHash(e.sha256)}</span>
                </span>
              </div>
            ))}

          {/* 5. The brief's own Hedera record, two seconds after it was stored. */}
          {beat >= ANCHOR && (
            <div className={cx(anim.enter, "flex min-h-10 items-center gap-2.5 rounded-control border border-line bg-surface-2 px-3 py-2 text-[13px]")}>
              <Status state={beat >= ANCHORED ? "done" : "run"} />
              <span className="min-w-0 text-fg">
                {beat >= ANCHORED ? "Brief hash anchored" : "Anchoring brief hash"}
                <span className="hidden sm:inline"> on Hedera</span>
              </span>
              <a
                href={hashscanTopic(a.hcs.topic)}
                className="group/l inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-mono text-[12px] text-fg-3 transition-colors hover:text-fg"
              >
                HCS <span className="hidden sm:inline">{a.hcs.topic}</span> #{a.hcs.sequence}
                <ArrowUpRight className="opacity-60 transition-transform group-hover/l:-translate-y-px group-hover/l:translate-x-px" />
              </a>
              <time dateTime={a.hcs.consensus_at} className="ml-auto shrink-0 font-mono text-[12px] text-fg-3">{hms(a.hcs.consensus_at)}</time>
            </div>
          )}
        </div>

        {/* Footer: what the replay is doing, and Replay. */}
        <div className="relative flex h-12 items-center gap-2.5 border-t px-4 text-[13px] sm:px-6">
          <span
            aria-hidden="true"
            className={cx("absolute inset-x-0 -top-px h-px origin-left bg-fg/35 transition-[scale,opacity] duration-500 ease-out", playing ? "opacity-100" : "opacity-0")}
            style={{ scale: `${(beat + (beat >= ANSWER && beat < CITED ? shown / TOTAL : 0)) / FINAL} 1` }}
          />
          {status && run > 0 ? (
            <>
              <Status state="run" />
              <span className="text-fg-2">Replaying · {status}</span>
            </>
          ) : (
            <span className="min-w-0 truncate font-mono text-[12px] text-fg-3">
              Recorded run · {a.created_at.slice(0, 10)} UTC
              <span className="hidden sm:inline"> · ${a.usd.toFixed(3)} model cost</span>
            </span>
          )}
          <div className="ml-auto motion-reduce:hidden">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (!playing) measure();
                setRun((n) => n + 1);
              }}
              aria-label="Replay the brief"
            >
              <ReplayIcon className="-ml-0.5 opacity-70 transition-transform duration-300 ease-out group-hover/btn:-rotate-45" />
              Replay
            </Button>
          </div>
        </div>
      </Window>

      {/* Outside the replay and labelled as its own event: the Analyst did not make this purchase. */}
      {beat >= FINAL && (
        <div className={cx(anim.enter, "mt-3 rounded-card border border-line px-4 py-3 text-[13px]")}>
          <p className="flex items-center gap-2.5">
            <ReceiptIcon className="shrink-0 text-fg-3" />
            <span className="min-w-0 text-fg-2">
              <span className="text-fg">Later, separately:</span> an x402 agent bought report{" "}
              <EvidenceId id={step.evidence} lit={lit(step.evidence)} />
            </span>
            <time dateTime={pay.consensus_at} className="ml-auto shrink-0 font-mono text-[12px] text-fg-3">{hms(pay.consensus_at)}</time>
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-[26px] font-mono text-[12px] text-fg-3">
            <span>
              payer <span className="text-fg-2">{pay.payer}</span>
            </span>
            <span className="text-fg-2">{hbar(pay.amount_tinybars)}</span>
            <span>
              sha256 <span className={cx("transition-colors duration-200", lit(step.evidence) ? "text-acc" : "text-fg-2")}>{shortHash(pay.report_sha256)}</span>
            </span>
            <a
              href={hashscanTx(pay.tx_id)}
              className="group/l inline-flex items-center gap-1 transition-colors hover:text-fg"
            >
              {pay.result === "SUCCESS" ? "settled" : pay.result.toLowerCase()} · HCS #{pay.hcs_sequence}
              <span className="sr-only">, payment {pay.tx_id} on HashScan</span>
              <ArrowUpRight className="opacity-60 transition-transform group-hover/l:-translate-y-px group-hover/l:translate-x-px" />
            </a>
          </p>
        </div>
      )}
    </div>
  );
}

/** An inline [E#] chip. Not a control: hovering it lights the evidence it cites; the evidence row holds the sha256. */
function Cite({ id, lit, onLight: light }: { id: string; lit: boolean; onLight: (id: string | null) => void }) {
  return (
    <span
      onMouseEnter={() => light(id)}
      onMouseLeave={() => light(null)}
      className={cx(
        "mx-px inline-flex h-[18px] -translate-y-px cursor-default items-center rounded-[5px] border px-1 align-middle font-mono text-[11px] leading-none transition-[color,background-color,border-color] duration-150",
        lit ? "border-acc/50 bg-acc/10 text-acc" : "border-line-strong bg-fg/[0.04] text-fg-2 hover:text-fg",
      )}
    >
      {id}
    </span>
  );
}

function EvidenceId({ id, lit }: { id: string; lit: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex h-[18px] shrink-0 items-center rounded-[5px] border px-1 align-middle font-mono text-[11px] leading-none transition-colors duration-200",
        lit ? "border-acc/50 bg-acc/10 text-acc" : "border-line-strong bg-fg/[0.04] text-fg-2",
      )}
    >
      {id}
    </span>
  );
}

