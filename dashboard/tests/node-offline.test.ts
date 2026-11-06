import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeOffline, type Collector } from "../lib/data";

const status = (poll_status: string, stream_status: string): Collector => ({ last_slot: "1", last_success: "", poll_status, stream_status });

test("node is offline only when polling fails and the Beacon stream is not connected", () => {
  assert.equal(nodeOffline(status("error", "network_verification_failed")), true);
  assert.equal(nodeOffline(status("error", "disabled")), true);
  assert.equal(nodeOffline(status("error", "connected")), false, "a connected stream proves the node is reachable");
  assert.equal(nodeOffline(status("ok", "unavailable")), false);
  assert.equal(nodeOffline(status("disabled", "disabled")), false, "stored-data-only mode is not an outage");
  assert.equal(nodeOffline(undefined), false, "unknown status shows no notice");
});
