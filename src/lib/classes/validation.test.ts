import { describe, expect, it } from "vitest";

import {
  createClassSchema,
  normalizeClassName,
} from "@/lib/classes/validation";

describe("class validation", () => {
  it("normalizes case and repeated whitespace for uniqueness", () => {
    expect(normalizeClassName("  Beginner   Ballet  ")).toBe("beginner ballet");
  });

  it("rejects names that are too short after cleanup", () => {
    expect(
      createClassSchema.safeParse({ name: " x ", description: "" }).success,
    ).toBe(false);
  });

  it("rejects descriptions beyond the database limit", () => {
    expect(
      createClassSchema.safeParse({
        name: "Valid class",
        description: "x".repeat(1001),
      }).success,
    ).toBe(false);
  });
});
