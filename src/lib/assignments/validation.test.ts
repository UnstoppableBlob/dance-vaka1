import { describe, expect, it } from "vitest";

import {
  assignmentDraftSchema,
  normalizeAssignmentTitle,
  parseLocalDueDate,
} from "@/lib/assignments/validation";

describe("assignment validation", () => {
  it("normalizes titles and optional instructions", () => {
    expect(normalizeAssignmentTitle("  Across   The Floor  ")).toBe(
      "across the floor",
    );
    expect(
      assignmentDraftSchema.parse({
        title: "  Across   The Floor  ",
        instructions: "   ",
        dueAt: null,
        referenceVideoAssetId: null,
      }),
    ).toMatchObject({ title: "Across The Floor", instructions: null });
  });

  it("parses a browser-local date using its timezone offset", () => {
    expect(parseLocalDueDate("2026-08-10T15:30", "420")?.toISOString()).toBe(
      "2026-08-10T22:30:00.000Z",
    );
    expect(parseLocalDueDate("", "0")).toBeNull();
    expect(() => parseLocalDueDate("not-a-date", "0")).toThrow();
    expect(() => parseLocalDueDate("2026-02-31T15:30", "0")).toThrow();
    expect(() => parseLocalDueDate("2026-08-10T15:30", "2000")).toThrow();
  });

  it("rejects short titles and oversized instructions", () => {
    expect(
      assignmentDraftSchema.safeParse({
        title: "x",
        instructions: "",
        dueAt: null,
        referenceVideoAssetId: null,
      }).success,
    ).toBe(false);
    expect(
      assignmentDraftSchema.safeParse({
        title: "Valid title",
        instructions: "x".repeat(5001),
        dueAt: null,
        referenceVideoAssetId: null,
      }).success,
    ).toBe(false);
  });
});
