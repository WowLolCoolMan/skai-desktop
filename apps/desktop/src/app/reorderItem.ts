export function reorderItem<T>(items: T[], sourceKey: string, targetKey: string, keyOf: (item: T) => string): T[] {
  const sourceIndex = items.findIndex((item) => keyOf(item) === sourceKey);
  const targetIndex = items.findIndex((item) => keyOf(item) === targetKey);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return items;

  const reordered = [...items];
  const [moved] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, moved);
  return reordered;
}
