// Case-insensitive substring filter over description + content.
export function filterSaves(saves, query) {
  const q = query.trim().toLowerCase();
  if (!q) return saves;
  return saves.filter(
    s =>
      s.content.toLowerCase().includes(q) ||
      (s.description && s.description.toLowerCase().includes(q))
  );
}
