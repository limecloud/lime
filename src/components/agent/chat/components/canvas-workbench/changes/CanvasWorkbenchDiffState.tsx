import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CanvasWorkbenchDisplayedDiffLine } from "../../../utils/canvasWorkbenchDiff";
import { renderCanvasWorkbenchDiffCodeLine } from "./CanvasWorkbenchDiffCode";

interface CanvasWorkbenchDiffStateProps {
  diffLines: CanvasWorkbenchDisplayedDiffLine[];
  panelClassName: string;
  variant?: "inline" | "split";
  filePath?: string;
  beforeLabel?: string;
  afterLabel?: string;
  showWhitespace?: boolean;
  wordWrapEnabled?: boolean;
  omittedLabel?: (count: number) => string;
}

function formatDiffLineValue(value: string, showWhitespace: boolean): string {
  if (!showWhitespace) {
    return value;
  }
  return value.replace(/ /g, "·").replace(/\t/g, "→   ");
}

function resolveDisplayedLineNumber(
  explicitLineNumber: number | null | undefined,
  fallbackLineNumber: number | null,
): number | null {
  if (typeof explicitLineNumber === "number") {
    return explicitLineNumber;
  }
  if (explicitLineNumber === null) return null;
  return fallbackLineNumber;
}

export function CanvasWorkbenchDiffState({
  diffLines,
  panelClassName,
  variant = "inline",
  filePath,
  beforeLabel = "",
  afterLabel = "",
  showWhitespace = false,
  wordWrapEnabled = true,
  omittedLabel = (count) => `${count} unchanged lines hidden`,
}: CanvasWorkbenchDiffStateProps) {
  if (variant === "split") {
    let beforeLineNumber = 0;
    let afterLineNumber = 0;

    return (
      <div
        className={cn("h-full overflow-hidden", panelClassName)}
        data-testid="canvas-workbench-split-diff"
      >
        <div className="grid border-b border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-subtle)] text-[11px] font-semibold text-[color:var(--lime-text-muted)] lg:grid-cols-2">
          <div
            className="border-b border-[color:var(--lime-surface-border)] px-3 py-2 lg:border-b-0 lg:border-r"
            data-testid="canvas-workbench-split-diff-before-header"
          >
            {beforeLabel}
          </div>
          <div
            className="px-3 py-2"
            data-testid="canvas-workbench-split-diff-after-header"
          >
            {afterLabel}
          </div>
        </div>
        <div className="max-h-[calc(100%-2.25rem)] overflow-auto">
          {diffLines.map((line, index) => {
            if (line.type === "omitted") {
              const beforeLine = resolveDisplayedLineNumber(
                line.oldLineNumber,
                beforeLineNumber + line.count,
              );
              const afterLine = resolveDisplayedLineNumber(
                line.newLineNumber,
                afterLineNumber + line.count,
              );
              beforeLineNumber += line.count;
              afterLineNumber += line.count;
              return (
                <div
                  key={`omitted-${index}`}
                  className="grid border-b border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-subtle)] text-[11px] font-medium text-[color:var(--lime-text-muted)] lg:grid-cols-2"
                  data-testid="canvas-workbench-split-diff-omitted"
                >
                  <div className="grid grid-cols-[48px_1fr] border-r border-[color:var(--lime-surface-border)]">
                    <span className="select-none border-r border-[color:var(--lime-surface-border)] px-2 py-2 text-right font-mono">
                      {beforeLine ?? ""}
                    </span>
                    <span className="px-3 py-2 text-center">
                      {omittedLabel(line.count)}
                    </span>
                  </div>
                  <div className="grid grid-cols-[48px_1fr]">
                    <span className="select-none border-r border-[color:var(--lime-surface-border)] px-2 py-2 text-right font-mono">
                      {afterLine ?? ""}
                    </span>
                    <span className="px-3 py-2 text-center">
                      {omittedLabel(line.count)}
                    </span>
                  </div>
                </div>
              );
            }

            const beforeLine =
              line.type === "add"
                ? null
                : resolveDisplayedLineNumber(
                    line.oldLineNumber,
                    beforeLineNumber + 1,
                  );
            const afterLine =
              line.type === "remove"
                ? null
                : resolveDisplayedLineNumber(
                    line.newLineNumber,
                    afterLineNumber + 1,
                  );

            if (line.type !== "add") {
              beforeLineNumber += 1;
            }
            if (line.type !== "remove") {
              afterLineNumber += 1;
            }

            return (
              <div
                key={`${line.type}-${index}`}
                data-diff-line-type={line.type}
                className="grid border-b border-[color:var(--lime-surface-border)] text-[12px] leading-6 lg:grid-cols-2"
              >
                <div
                  className={cn(
                    "grid grid-cols-[48px_1fr] border-r border-[color:var(--lime-surface-border)] font-mono",
                    line.type === "remove" &&
                      "bg-[color:var(--lime-danger-soft)] text-[color:var(--lime-text-strong)]",
                    line.type === "add" &&
                      "bg-[color:var(--lime-surface-subtle)] text-[color:var(--lime-text-muted)]",
                    line.type === "context" && "text-[color:var(--lime-text)]",
                  )}
                  data-testid="canvas-workbench-split-diff-before"
                >
                  <span
                    className={cn(
                      "select-none border-r border-[color:var(--lime-surface-border)] px-2 text-right text-[11px] text-[color:var(--lime-text-muted)]",
                      line.type === "remove" &&
                        "bg-[color:var(--lime-danger-border)] text-[color:var(--lime-text-strong)]",
                    )}
                  >
                    {beforeLine ?? ""}
                  </span>
                  <span
                    className={cn(
                      "px-3 py-1.5",
                      wordWrapEnabled
                        ? "whitespace-pre-wrap break-all"
                        : "whitespace-pre",
                    )}
                  >
                    {line.type === "add"
                      ? " "
                      : renderCanvasWorkbenchDiffCodeLine(
                          formatDiffLineValue(line.value, showWhitespace),
                          filePath,
                        ) || " "}
                  </span>
                </div>
                <div
                  className={cn(
                    "grid grid-cols-[48px_1fr] font-mono",
                    line.type === "add" &&
                      "bg-[color:var(--lime-brand-soft)] text-[color:var(--lime-text-strong)]",
                    line.type === "remove" &&
                      "bg-[color:var(--lime-surface-subtle)] text-[color:var(--lime-text-muted)]",
                    line.type === "context" && "text-[color:var(--lime-text)]",
                  )}
                  data-testid="canvas-workbench-split-diff-after"
                >
                  <span
                    className={cn(
                      "select-none border-r border-[color:var(--lime-surface-border)] px-2 text-right text-[11px] text-[color:var(--lime-text-muted)]",
                      line.type === "add" &&
                        "bg-[color:var(--lime-brand-muted)] text-[color:var(--lime-text-strong)]",
                    )}
                  >
                    {afterLine ?? ""}
                  </span>
                  <span
                    className={cn(
                      "px-3 py-1.5",
                      wordWrapEnabled
                        ? "whitespace-pre-wrap break-all"
                        : "whitespace-pre",
                    )}
                  >
                    {line.type === "remove"
                      ? " "
                      : renderCanvasWorkbenchDiffCodeLine(
                          formatDiffLineValue(line.value, showWhitespace),
                          filePath,
                        ) || " "}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  let lineNumber = 0;

  return (
    <div
      className={cn(
        "h-full overflow-hidden border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)]",
        panelClassName,
      )}
      data-testid="canvas-workbench-inline-diff"
    >
      <div className="h-full overflow-auto">
        {diffLines.map((line, index) => {
          if (line.type === "omitted") {
            const displayedLineNumber = resolveDisplayedLineNumber(
              line.newLineNumber ?? line.oldLineNumber,
              lineNumber + line.count,
            );
            lineNumber += line.count;
            return (
              <div
                key={`omitted-${index}`}
                className="grid grid-cols-[52px_28px_minmax(0,1fr)] border-b border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-muted)] text-[11px] font-medium text-[color:var(--lime-text-muted)]"
                data-testid="canvas-workbench-diff-omitted"
              >
                <span className="px-2 py-2 text-right font-mono">
                  {displayedLineNumber}
                </span>
                <span className="flex items-center justify-center px-1 py-2 text-[color:var(--lime-text-muted)]">
                  <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden />
                </span>
                <span className="px-3 py-2">{omittedLabel(line.count)}</span>
              </div>
            );
          }

          lineNumber += 1;
          const displayedLineNumber = resolveDisplayedLineNumber(
            line.newLineNumber ?? line.oldLineNumber,
            lineNumber,
          );
          return (
            <div
              key={`${line.type}-${index}`}
              data-diff-line-type={line.type}
              className={cn(
                "grid grid-cols-[52px_28px_minmax(0,1fr)] border-b border-[color:var(--lime-surface-border)] border-l-2 font-mono text-[12px] leading-6",
                line.type === "add" &&
                  "border-l-[color:var(--lime-diff-add-border)] bg-[color:var(--lime-diff-add-bg)] text-[color:var(--lime-text-strong)]",
                line.type === "remove" &&
                  "border-l-[color:var(--lime-diff-remove-border)] bg-[color:var(--lime-diff-remove-bg)] text-[color:var(--lime-text-strong)]",
                line.type === "context" &&
                  "border-l-transparent bg-[color:var(--lime-surface)] text-[color:var(--lime-text)]",
              )}
            >
              <span
                className={cn(
                  "select-none border-r border-[color:var(--lime-surface-border)] px-2 py-1.5 text-right text-[11px] text-[color:var(--lime-text-muted)]",
                  line.type === "add" &&
                    "bg-[color:var(--lime-diff-add-number-bg)] text-[color:var(--lime-text-strong)]",
                  line.type === "remove" &&
                    "bg-[color:var(--lime-diff-remove-number-bg)] text-[color:var(--lime-text-strong)]",
                )}
              >
                {displayedLineNumber}
              </span>
              <span
                className={cn(
                  "select-none border-r border-[color:var(--lime-surface-border)] px-1 py-1.5 text-center font-semibold",
                  line.type === "add" &&
                    "text-[color:var(--lime-diff-add-border)]",
                  line.type === "remove" &&
                    "text-[color:var(--lime-diff-remove-border)]",
                  line.type === "context" &&
                    "text-[color:var(--lime-text-muted)]",
                )}
              >
                {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
              </span>
              <span
                className={cn(
                  "px-3 py-1.5",
                  wordWrapEnabled
                    ? "whitespace-pre-wrap break-all"
                    : "whitespace-pre",
                )}
              >
                {renderCanvasWorkbenchDiffCodeLine(
                  formatDiffLineValue(line.value, showWhitespace),
                  filePath,
                ) || " "}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
