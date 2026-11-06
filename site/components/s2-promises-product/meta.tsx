import { Fragment } from "react";

/**
 * Muted mono "a · b · c". Below sm the parts stack one per line with no separators, so a wrap never strands a
 * dot at a line end or start. Falsy parts (null fields) are dropped.
 */
export function Meta({ parts }: { parts: (string | null | false)[] }) {
  return (
    <p className="flex flex-col items-end font-mono text-label text-muted sm:block">
      {parts.filter(Boolean).map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="hidden sm:inline"> · </span>}
          <span className="whitespace-nowrap">{p}</span>
        </Fragment>
      ))}
    </p>
  );
}
