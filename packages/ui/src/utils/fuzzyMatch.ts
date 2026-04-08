export function fuzzyMatch(query: string, text: string): { match: boolean; score: number } {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();

  // Empty query matches everything
  if (!q) return { match: true, score: 0 };

  // Exact substring match scores highest
  if (lower.includes(q)) {
    const idx = lower.indexOf(q);
    // Bonus for matching at word start
    const atStart = idx === 0 || text[idx - 1] === ' ';
    return { match: true, score: atStart ? 100 - idx : 50 - idx };
  }

  // Fuzzy: every query char must appear in order
  let qi = 0;
  let score = 0;
  let prevIdx = -1;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) {
      score += (i === prevIdx + 1) ? 3 : 1;
      prevIdx = i;
      qi++;
    }
  }

  if (qi === q.length) {
    return { match: true, score };
  }
  return { match: false, score: 0 };
}
