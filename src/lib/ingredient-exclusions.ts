/** Commas and newlines separate entries in the household editor. */
export function parseIngredientExclusions(text: string): string[] {
  const names = new Map<string, string>();
  for (const part of text.split(/[,\n]/)) {
    const name = part.trim().normalize('NFKC');
    if (!name) continue;
    if (name.length > 80 || /[<>\r]/.test(name)) throw new Error('Invalid ingredient exclusion');
    names.set(name.toLowerCase(), name);
  }
  if (names.size > 30) throw new Error('Too many ingredient exclusions');
  return [...names.values()];
}

/** Literal names/phrases only; the server's recipe review handles synonyms and translations. */
export function hasExcludedIngredient(ingredients: string[], exclusions: string[]): boolean {
  return exclusions.some((excluded) => {
    const term = excluded.trim().normalize('NFKC').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!term) return false;
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${term}($|[^\\p{L}\\p{N}])`, 'u');
    return ingredients.some((name) => pattern.test(name.normalize('NFKC').toLowerCase()));
  });
}
