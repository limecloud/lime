import { normalizeWorkspacePath } from "../../../workspace/workspacePath";

import { extractFileNameFromPath } from "../../../workspace/workspacePath";
import type { CanvasWorkbenchDiffLine } from "../../../utils/canvasWorkbenchDiff";
import type {
  CanvasWorkbenchChangeItem,
  CanvasWorkbenchChangeKind,
} from "./CanvasWorkbenchChangesPanelViewModel";

export function parseCanvasWorkbenchGitPatchToChangeItems(
  patch: string,
): CanvasWorkbenchChangeItem[] {
  const sections = splitGitPatchSections(patch);
  return sections.flatMap((section, index) => {
    const item = parseGitPatchSection(section, index);
    return item ? [item] : [];
  });
}

export function parseCanvasWorkbenchPatchDiffLines(
  patch: string,
): CanvasWorkbenchDiffLine[] {
  const lines = patch.split(/\r?\n/);
  if (lines.some((line) => line.startsWith("@@"))) {
    return parseGitPatchDiffLines(lines);
  }
  return parseGitPatchDiffLines(["@@ -1 +1 @@", ...lines]).map((line) => ({
    ...line,
    oldLineNumber: null,
    newLineNumber: null,
  }));
}

export function hasCanvasWorkbenchPatchLineNumbers(
  lines: readonly CanvasWorkbenchDiffLine[],
): boolean {
  return lines.every((line) =>
    line.type === "remove"
      ? Number.isInteger(line.oldLineNumber) && Number(line.oldLineNumber) > 0
      : Number.isInteger(line.newLineNumber) && Number(line.newLineNumber) > 0,
  );
}

/** 使用 patch 的真实坐标补齐未变化行；文件与 patch 不一致时拒绝拼接。 */
export function expandCanvasWorkbenchPatchDiffLines(
  patchLines: readonly CanvasWorkbenchDiffLine[],
  currentContent: string,
): CanvasWorkbenchDiffLine[] | null {
  if (!hasCanvasWorkbenchPatchLineNumbers(patchLines)) return null;
  const currentLines = currentContent
    ? currentContent.replace(/\r\n/g, "\n").split("\n")
    : [];
  const result: CanvasWorkbenchDiffLine[] = [];
  let oldCursor = 1;
  let newCursor = 1;
  const appendContext = (count: number) => {
    for (let index = 0; index < count; index += 1) {
      result.push({
        type: "context",
        value: currentLines[newCursor - 1],
        oldLineNumber: oldCursor++,
        newLineNumber: newCursor++,
      });
    }
  };

  for (const line of patchLines) {
    const gap =
      line.type === "remove"
        ? Number(line.oldLineNumber) - oldCursor
        : Number(line.newLineNumber) - newCursor;
    if (gap < 0 || newCursor + gap - 1 > currentLines.length) return null;
    if (
      line.type === "context" &&
      Number(line.oldLineNumber) - oldCursor !== gap
    )
      return null;
    appendContext(gap);
    if (line.type !== "remove" && currentLines[newCursor - 1] !== line.value) {
      return null;
    }
    result.push(line);
    if (line.type !== "add") oldCursor += 1;
    if (line.type !== "remove") newCursor += 1;
  }
  appendContext(currentLines.length - newCursor + 1);
  return result;
}

function splitGitPatchSections(patch: string): string[][] {
  const sections: string[][] = [];
  let current: string[] = [];

  patch
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((line) => {
      if (line.startsWith("diff --git ")) {
        if (current.length > 0) {
          sections.push(current);
        }
        current = [line];
        return;
      }
      if (current.length > 0) {
        current.push(line);
      }
    });

  if (current.length > 0) {
    sections.push(current);
  }
  return sections;
}

function parseGitPatchSection(
  lines: string[],
  index: number,
): CanvasWorkbenchChangeItem | null {
  const diffHeader = lines.find((line) => line.startsWith("diff --git "));
  if (!diffHeader) {
    return null;
  }

  const oldPath = parseDiffHeaderPath(diffHeader, "a/");
  const newPath = parseDiffHeaderPath(diffHeader, "b/");
  const minusPath = lines
    .find((line) => line.startsWith("--- "))
    ?.slice(4)
    .trim();
  const plusPath = lines
    .find((line) => line.startsWith("+++ "))
    ?.slice(4)
    .trim();
  const path =
    normalizeGitPatchPath(plusPath) ||
    normalizeGitPatchPath(newPath) ||
    normalizeGitPatchPath(minusPath) ||
    normalizeGitPatchPath(oldPath);
  if (!path) {
    return null;
  }

  const diffLines = parseGitPatchDiffLines(lines);
  const preview = diffLines.find((line) => line.type !== "context")?.value;
  const changeKind = inferGitPatchChangeKind(lines);
  const hunk = parseGitPatchHunk(lines);

  return {
    id: `git:${index}:${path}`,
    path,
    displayName: extractFileNameFromPath(path),
    source: "git",
    status: "completed",
    changeKind,
    preview,
    diffLines,
    hunkStartLine: hunk?.newStart ?? undefined,
    hunkEndLine:
      hunk && hunk.newLength > 0
        ? hunk.newStart + hunk.newLength - 1
        : (hunk?.newStart ?? undefined),
    hunkHeader: hunk?.header,
  };
}

interface ParsedGitPatchHunk {
  header: string;
  oldStart: number;
  oldLength: number;
  newStart: number;
  newLength: number;
}

function parseGitPatchHunk(lines: string[]): ParsedGitPatchHunk | null {
  const hunkLine = lines.find((line) => line.startsWith("@@"));
  if (!hunkLine) {
    return null;
  }

  const match = hunkLine.match(
    /^@@ -(?<oldStart>\d+)(?:,(?<oldLength>\d+))? \+(?<newStart>\d+)(?:,(?<newLength>\d+))? @@/,
  );
  if (!match?.groups) {
    return null;
  }

  const oldStart = Number.parseInt(match.groups.oldStart || "0", 10);
  const oldLength = Number.parseInt(match.groups.oldLength || "1", 10);
  const newStart = Number.parseInt(match.groups.newStart || "0", 10);
  const newLength = Number.parseInt(match.groups.newLength || "1", 10);

  return {
    header: hunkLine,
    oldStart: Number.isFinite(oldStart) ? oldStart : 0,
    oldLength: Number.isFinite(oldLength) ? oldLength : 0,
    newStart: Number.isFinite(newStart) ? newStart : 0,
    newLength: Number.isFinite(newLength) ? newLength : 0,
  };
}

function parseDiffHeaderPath(header: string, prefix: "a/" | "b/"): string {
  const marker = ` ${prefix}`;
  const index = header.indexOf(marker);
  if (index < 0) {
    return "";
  }
  return header.slice(index + 1).split(/\s+/)[0] || "";
}

function normalizeGitPatchPath(value: string | null | undefined): string {
  const trimmed = (value || "").trim();
  if (!trimmed || trimmed === "/dev/null" || trimmed === "NUL") {
    return "";
  }
  return normalizeWorkspacePath(
    trimmed.replace(/^"|"$/g, "").replace(/^[ab]\//, ""),
  ).replace(/^\/+/, "");
}

function parseGitPatchDiffLines(lines: string[]): CanvasWorkbenchDiffLine[] {
  const diffLines: CanvasWorkbenchDiffLine[] = [];
  let inHunk = false;
  let oldLineNumber = 0;
  let newLineNumber = 0;

  lines.forEach((line) => {
    if (line.startsWith("@@")) {
      inHunk = true;
      const hunk = parseGitPatchHunk([line]);
      oldLineNumber = hunk?.oldStart ?? 0;
      newLineNumber = hunk?.newStart ?? 0;
      return;
    }
    if (!inHunk || line.startsWith("\\ No newline")) {
      return;
    }
    if (line.startsWith("+") && !line.startsWith("+++ ")) {
      diffLines.push({
        type: "add",
        value: line.slice(1),
        oldLineNumber: null,
        newLineNumber,
      });
      newLineNumber += 1;
      return;
    }
    if (line.startsWith("-") && !line.startsWith("--- ")) {
      diffLines.push({
        type: "remove",
        value: line.slice(1),
        oldLineNumber,
        newLineNumber: null,
      });
      oldLineNumber += 1;
      return;
    }
    if (line.startsWith(" ")) {
      diffLines.push({
        type: "context",
        value: line.slice(1),
        oldLineNumber,
        newLineNumber,
      });
      oldLineNumber += 1;
      newLineNumber += 1;
    }
  });

  return diffLines;
}

function inferGitPatchChangeKind(lines: string[]): CanvasWorkbenchChangeKind {
  if (lines.some((line) => line.startsWith("new file mode "))) {
    return "added";
  }
  if (lines.some((line) => line.startsWith("deleted file mode "))) {
    return "deleted";
  }
  if (lines.some((line) => line.startsWith("rename from "))) {
    return "renamed";
  }
  if (lines.some((line) => line.startsWith("copy from "))) {
    return "copied";
  }
  return "modified";
}
