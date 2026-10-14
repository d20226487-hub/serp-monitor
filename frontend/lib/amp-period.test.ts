import { describe, expect, it } from "vitest";
import { ampDay, ampPeriodText } from "./amp-period";

const since = (day: string) => `since ${day}`;

describe("ampPeriodText", () => {
  it("says since when while the rotator still names it", () => {
    expect(ampPeriodText({ from: "2026-10-13T04:11:35", to: null }, since)).toBe(`since ${ampDay("2026-10-13T04:11:35")}`);
  });

  it("gives the days once the rotator has moved on", () => {
    const text = ampPeriodText({ from: "2026-10-12T02:00:05", to: "2026-10-13T02:00:05" }, since);
    expect(text).toBe(`${ampDay("2026-10-12T02:00:05")}–${ampDay("2026-10-13T02:00:05")}`);
  });

  it("gives one day once for a single day", () => {
    expect(ampPeriodText({ from: "2026-10-12T02:00:05", to: "2026-10-12T02:00:09" }, since)).toBe(
      ampDay("2026-10-12T02:00:05"),
    );
  });

  it("says nothing when nothing is known", () => {
    expect(ampPeriodText(null, since)).toBeNull();
    expect(ampPeriodText(undefined, since)).toBeNull();
    expect(ampPeriodText({ from: null, to: null }, since)).toBeNull();
  });

  it("reads a server time as UTC", () => {
    // Stored naive UTC: the same moment with and without the Z.
    expect(ampDay("2026-10-13T23:30:00")).toBe(ampDay("2026-10-13T23:30:00Z"));
  });
});
