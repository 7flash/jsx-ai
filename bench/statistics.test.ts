import { describe, expect, test } from "bun:test";
import { mean, percentile, seededShuffle, stddev, wilson } from "./statistics";

describe("benchmark statistics", () => {
  test("shuffle is deterministic for a seed", () => {
    expect(seededShuffle([1, 2, 3, 4], 42)).toEqual(
      seededShuffle([1, 2, 3, 4], 42),
    );
  });

  test("summary statistics handle small samples", () => {
    expect(mean([1, 3])).toBe(2);
    expect(stddev([2])).toBe(0);
    expect(percentile([1, 10, 5], 0.5)).toBe(5);
    const [low, high] = wilson(5, 10);
    expect(low).toBeLessThan(0.5);
    expect(high).toBeGreaterThan(0.5);
  });
});
