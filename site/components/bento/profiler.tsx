import { num } from "@/lib/format";
import { cx } from "@/lib/cx";
import { Panel } from "./panel";
import { profile } from "./evidence";
import s from "./bento.module.css";

const msOf = (ns: number) => (ns / 1e6).toFixed(2);

/**
 * The representative replay sample split into the four non-overlapping slices the dashboard uses
 * (docs/EXECUTION_PROFILER.md); they sum to the sample's ApplyMessage total.
 */
export function ProfilerMini() {
  const p = profile;
  const stateOutside = p.state_access_ns - p.state_inside_evm_ns;
  const slices = [
    { name: "EVM, outside state", ns: p.evm_call_ns - p.state_inside_evm_ns, bar: "bg-fg/40" },
    { name: "state calls in EVM", ns: p.state_inside_evm_ns, bar: "bg-acc" },
    { name: "state calls outside", ns: stateOutside, bar: "bg-acc/45" },
    { name: "other ApplyMessage", ns: p.apply_ns - p.evm_call_ns - stateOutside, bar: "bg-fg/15" },
  ];

  return (
    <Panel crumb="Execution profiler" title={<span className="font-mono">{num(p.block_number)}</span>} meta={`${p.samples} runs`} className="lg:h-[244px]">
      <div className="flex flex-1 flex-col px-4 pt-3.5 pb-4">
        <div className="flex items-end justify-between gap-3">
          <p className="font-mono text-[22px] leading-none tracking-[-0.03em] text-fg">
            {msOf(p.apply_ns)}
            <span className="text-[13px] tracking-normal text-fg-3"> ms</span>
          </p>
          {/* The headline is the instrumented time; the control line under the bar is the real one (docs/EXECUTION_PROFILER.md). */}
          <p className="text-right text-[11px] leading-tight text-fg-3">
            instrumented ApplyMessage
            <br />
            median sample
          </p>
        </div>
        <div aria-hidden="true" className={cx(s.measure, "mt-3.5 flex h-2 origin-left gap-px overflow-hidden rounded-[3px]")}>
          {slices.map((x) => (
            <span key={x.name} className={cx("h-full min-w-px", x.bar)} style={{ flexGrow: x.ns, flexBasis: 0 }} />
          ))}
        </div>
        <p className="mt-2 font-mono text-[11px] text-fg-3">
          uninstrumented control (real time): <span className="text-fg-2">{msOf(p.control_median_ns)} ms</span>
        </p>
        <dl className="mt-auto font-mono text-[11px]">
          {slices.map((x) => (
            <div key={x.name} className="flex h-[22px] items-center gap-2 border-b last:border-b-0">
              <span aria-hidden="true" className={cx("size-1.5 shrink-0 rounded-[1px]", x.bar)} />
              <dt className="min-w-0 truncate text-fg-2">{x.name}</dt>
              <dd className="ml-auto text-fg">
                {msOf(x.ns)}
                <span className="text-fg-3"> ms</span>
              </dd>
              <dd className="w-[42px] text-right text-fg-3 max-[374px]:hidden">{((x.ns / p.apply_ns) * 100).toFixed(1)}%</dd>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}
