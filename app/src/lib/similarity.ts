export function similarity(a: string, b: string): number {
  const an = a.toLowerCase().trim();
  const bn = b.toLowerCase().trim();
  if (an === bn) return 1;
  if (an.length < 2 || bn.length < 2) return 0;

  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };

  const aGrams = bigrams(an);
  const bGrams = bigrams(bn);
  let intersection = 0;
  for (const g of aGrams) if (bGrams.has(g)) intersection++;
  return (2 * intersection) / (aGrams.size + bGrams.size);
}
