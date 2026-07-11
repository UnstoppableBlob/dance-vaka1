import { describe, expect, it } from "vitest";

import {
  createAlignedSampleTimes,
  formatAnalysisTime,
  getTimelineColor,
} from "@/lib/pose-comparison/sampling";

describe("browser analysis sampling", () => {
  it("aligns frames by normalized progress across different durations", () => {
    const samples = createAlignedSampleTimes({
      masterDuration: 10,
      studentDuration: 20,
      sampleFps: 1,
      maxFrames: 12,
    });

    expect(samples).toHaveLength(12);
    expect(samples[0]).toEqual({
      index: 0,
      progress: 0,
      masterTime: 0,
      studentTime: 0,
    });
    expect(samples.at(-1)).toEqual({
      index: 11,
      progress: 1,
      masterTime: 10,
      studentTime: 20,
    });
  });

  it("enforces sampling bounds and rejects videos without durations", () => {
    expect(
      createAlignedSampleTimes({
        masterDuration: 100,
        studentDuration: 100,
        sampleFps: 100,
        maxFrames: 1000,
      }),
    ).toHaveLength(432);
    expect(() =>
      createAlignedSampleTimes({ masterDuration: 0, studentDuration: 10 }),
    ).toThrow("valid duration");
  });

  it("samples default analyses at eight frames per second", () => {
    expect(
      createAlignedSampleTimes({ masterDuration: 10, studentDuration: 10 }),
    ).toHaveLength(80);
    expect(
      createAlignedSampleTimes({ masterDuration: 30, studentDuration: 30 }),
    ).toHaveLength(240);
  });

  it("formats review times and produces deterministic timeline states", () => {
    expect(formatAnalysisTime(62.34)).toBe("1:02.3");
    expect(getTimelineColor(null)).toBe("bg-slate-500");
    expect(getTimelineColor(90)).toBe("bg-emerald-500");
    expect(getTimelineColor(70)).toBe("bg-amber-400");
    expect(getTimelineColor(40)).toBe("bg-red-500");
  });
});
