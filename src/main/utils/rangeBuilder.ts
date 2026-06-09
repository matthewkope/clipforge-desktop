export function buildRange(items: number[]): string {
  const sorted = Array.from(new Set(items))
    .filter((item) => Number.isInteger(item) && item > 0)
    .sort((a, b) => a - b);

  const ranges: string[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const start = sorted[index];
    let end = start;
    while (sorted[index + 1] === end + 1) {
      index += 1;
      end = sorted[index];
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
  }

  return ranges.join(',');
}
