export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const output = [...items];
  let state = seed >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  for (let index = output.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    const value = output[index];
    output[index] = output[target];
    output[target] = value;
  }
  return output;
}

export function mean(values: readonly number[]): number {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

export function stddev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
      (values.length - 1),
  );
}

export function percentile(
  values: readonly number[],
  probability: number,
): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(probability * sorted.length) - 1),
  );
  return sorted[index];
}

/** Wilson score interval for a Bernoulli success rate. */
export function wilson(
  successes: number,
  n: number,
  z = 1.96,
): [number, number] {
  if (n === 0) return [0, 0];
  const p = successes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const margin =
    (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}
