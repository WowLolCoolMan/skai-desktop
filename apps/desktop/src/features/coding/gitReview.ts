export type ReviewDiffLine = { kind: "context" | "added" | "removed"; oldLine: number | null; newLine: number | null; text: string };
export type ReviewDiffHunk = { id: number; header: string; lines: ReviewDiffLine[] };
export type ReviewDiffFile = { oldPath: string; path: string; kind: "added" | "modified" | "deleted" | "renamed" | "binary"; hunks: ReviewDiffHunk[] };

function unquoteGitPath(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"')) return trimmed;
  try { return JSON.parse(trimmed) as string; } catch {
    return trimmed.slice(1, -1).replace(/\\([0-7]{1,3})/g, (_, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)));
  }
}

function readDiffHeaderPath(source: string, start: number) {
  while (source[start] === " ") start += 1;
  if (source[start] === '"') {
    let end = start + 1;
    while (end < source.length) {
      if (source[end] === "\\") { end += 2; continue; }
      if (source[end] === '"') return { value: source.slice(start, end + 1), next: end + 1 };
      end += 1;
    }
    return { value: source.slice(start), next: source.length };
  }
  let end = start;
  while (end < source.length && source[end] !== " ") end += 1;
  return { value: source.slice(start, end), next: end };
}

function parseDiffHeader(line: string) {
  const source = line.slice("diff --git ".length);
  const first = readDiffHeaderPath(source, 0);
  const second = readDiffHeaderPath(source, first.next);
  return first.value && second.value ? [first.value, second.value] as const : null;
}

function normalizeGitPath(value: string, prefix: "a/" | "b/") {
  const decoded = unquoteGitPath(value);
  return decoded.startsWith(prefix) ? decoded.slice(prefix.length) : decoded;
}

export function parseGitReviewDiff(text: string): ReviewDiffFile[] {
  const blocks = text.split(/(?=^diff --git )/m).filter((block) => block.startsWith("diff --git "));
  return blocks.map((block) => {
    const lines = block.split("\n");
    const paths = parseDiffHeader(lines[0]);
    let oldPath = paths ? normalizeGitPath(paths[0], "a/") : "Unknown path";
    let path = paths ? normalizeGitPath(paths[1], "b/") : oldPath;
    let kind: ReviewDiffFile["kind"] = "modified";
    for (const line of lines) {
      if (line.startsWith("new file mode ")) kind = "added";
      else if (line.startsWith("deleted file mode ")) kind = "deleted";
      else if (line.startsWith("rename from ")) { oldPath = unquoteGitPath(line.slice("rename from ".length)); kind = "renamed"; }
      else if (line.startsWith("rename to ")) path = unquoteGitPath(line.slice("rename to ".length));
      else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) kind = "binary";
    }
    const hunks: ReviewDiffHunk[] = [];
    let current: ReviewDiffHunk | null = null;
    let oldLine = 0;
    let newLine = 0;
    for (const line of lines) {
      const header = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (header) {
        current = { id: hunks.length, header: line, lines: [] };
        hunks.push(current);
        oldLine = Number(header[1]);
        newLine = Number(header[2]);
        continue;
      }
      if (!current || !line.length) continue;
      if (line.startsWith("\\ No newline")) continue;
      if (line.startsWith("+")) current.lines.push({ kind: "added", oldLine: null, newLine: newLine++, text: line.slice(1) });
      else if (line.startsWith("-")) current.lines.push({ kind: "removed", oldLine: oldLine++, newLine: null, text: line.slice(1) });
      else if (line.startsWith(" ")) current.lines.push({ kind: "context", oldLine: oldLine++, newLine: newLine++, text: line.slice(1) });
      else if (line.startsWith("diff --git ")) current = null;
    }
    return { oldPath, path, kind, hunks };
  });
}

export function gitChangeLabel(status: string, kind?: ReviewDiffFile["kind"]) {
  if (kind) return kind[0].toUpperCase() + kind.slice(1);
  const value = status.trim().toUpperCase();
  if (value.includes("R")) return "Renamed";
  if (value.includes("D")) return "Deleted";
  if (value.includes("A") || value === "??") return "Added";
  if (value.includes("C")) return "Copied";
  return "Modified";
}
