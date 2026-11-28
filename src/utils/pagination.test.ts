import { describe, expect, it } from "vitest";
import {
  computeGlobalPageStats,
  computeTtsGlobalPage,
  resolveGlobalPageTarget,
} from "./pagination";

describe("pagination utilities", () => {
  it("computes global pages and resolves direct page jumps across chapters", () => {
    // Ch0: 4500 chars (3 pages), Ch1: 3000 chars (2 pages), Ch2: 15000 chars (10 pages)
    const map = [4500, 3000, 15000];
    const stats = computeGlobalPageStats(map, 2, 3, 10);
    expect(stats.chapterStartGlobalPage).toBe(6);
    expect(stats.currentGlobalPage).toBe(9);
    expect(stats.totalGlobalPages).toBe(15);

    const target = resolveGlobalPageTarget(map, 10);
    expect(target.spineIndex).toBe(2);
    expect(target.pageIndexInChapter).toBe(4);
    expect(target.fractionInChapter).toBeCloseTo(0.4, 3);
  });

  it("tracks separate TTS page independently from reading page", () => {
    const map = [4500, 6000, 3000]; // Ch0=3p, Ch1=4p, Ch2=2p
    const ttsPage = computeTtsGlobalPage(map, 1, 2100);
    // Ch0 (3 pages) + floor(2100/1500)=1 -> page 5
    expect(ttsPage).toBe(5);
  });
});
