/** Joins class names, skipping falsy ones. No merging: avoid passing utilities that conflict with a component's own. */
export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");
