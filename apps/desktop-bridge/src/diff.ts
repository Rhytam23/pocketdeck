/** Minimal line diff (LCS) for showing the user a settings change before it is written. */
export function unifiedDiff(before: string, after: string, label = "settings.json"): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push("  " + a[i]);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push("- " + a[i++]);
    } else {
      out.push("+ " + b[j++]);
    }
  }
  while (i < n) out.push("- " + a[i++]);
  while (j < m) out.push("+ " + b[j++]);
  if (!out.some((l) => l.startsWith("+ ") || l.startsWith("- "))) return "";
  // Keep 2 lines of context around changes.
  const keep = new Array<boolean>(out.length).fill(false);
  out.forEach((l, k) => {
    if (l[0] !== " ") for (let d = -2; d <= 2; d++) if (out[k + d] !== undefined) keep[k + d] = true;
  });
  const lines: string[] = [`--- ${label}`, `+++ ${label} (with PocketDeck hooks)`];
  let gap = false;
  out.forEach((l, k) => {
    if (keep[k]) {
      if (gap) lines.push("  ...");
      gap = false;
      lines.push(l);
    } else gap = true;
  });
  return lines.join("\n");
}
