import { test } from "node:test";
import assert from "node:assert/strict";
import { observationScope } from "../lib/observation-scope";

test("unresolved live source cannot request legacy beacon observations", () => {
  assert.equal(observationScope("live"), null);
  assert.equal(observationScope("live", ""), null);
  assert.equal(observationScope("live", "  "), null);
});

test("configured live source is encoded without changing its evidence mode", () => {
  for (const source of ["sepolia-nimbus-geth-1", "phase7-healthy", "node&mode=synthetic"]) {
    const params = new URLSearchParams(observationScope("live", source)!);
    assert.equal(params.get("source"), source);
    assert.equal(params.get("mode"), "live");
    assert.equal(params.get("network"), "sepolia");
  }
});

test("synthetic demo remains independently available before live discovery", () => {
  const params = new URLSearchParams(observationScope("synthetic", "phase3-demo")!);
  assert.equal(params.get("source"), "phase3-demo");
  assert.equal(params.get("mode"), "synthetic");
});
