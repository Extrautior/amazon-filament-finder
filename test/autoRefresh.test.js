const test = require("node:test");
const assert = require("node:assert/strict");
const { getNextAutoRefreshRun } = require("../src/autoRefresh");

test("getNextAutoRefreshRun returns the same-day evening slot after the morning slot passes", () => {
  const now = new Date("2026-04-22T06:30:00.000Z");
  const nextRun = getNextAutoRefreshRun(now, {
    timeZone: "Asia/Jerusalem",
    hours: [8, 20]
  });

  assert.equal(nextRun.toISOString(), "2026-04-22T17:00:00.000Z");
});

test("getNextAutoRefreshRun returns the next morning slot after the evening slot passes", () => {
  const now = new Date("2026-04-22T18:30:00.000Z");
  const nextRun = getNextAutoRefreshRun(now, {
    timeZone: "Asia/Jerusalem",
    hours: [8, 20]
  });

  assert.equal(nextRun.toISOString(), "2026-04-23T05:00:00.000Z");
});
