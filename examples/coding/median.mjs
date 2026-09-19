export function median(values) {
  if (!Array.isArray(values) || values.length === 0)
    throw new Error('values must be a non-empty array');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
