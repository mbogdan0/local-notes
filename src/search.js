// Case-insensitive substring filter over description + content, optionally
// narrowed to starred notes.
export function filterSaves(saves, query, { starredOnly = false } = {}) {
  const base = starredOnly ? saves.filter(s => s.starred) : saves;
  const q = query.trim().toLowerCase();
  if (!q) return base;
  return base.filter(
    s =>
      s.content.toLowerCase().includes(q) ||
      (s.description && s.description.toLowerCase().includes(q))
  );
}
