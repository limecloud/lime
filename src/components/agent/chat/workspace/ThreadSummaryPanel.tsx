import { SummarySection, SummaryRow } from "./ThreadSummarySection";
import { ThreadSources } from "./ThreadSources";
import { buildTimelinePatchContentPart } from "../components/messageListTimelineContentPartBuilders";
import { requestOpenChangesSurface } from "./workspaceChangesSurfaceEvents";
import { Bot, FileText, ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MessageListProps } from "../components/MessageList.types";
import type { CanonicalChildThreadSummary } from "../projection/canonicalChildThreadSummary";
import type { AgentThreadItem } from "@/lib/api/agentProtocol";
import { selectThreadSummary } from "./threadSummaryProjection";
import {
  selectBackgroundTerminals,
  type BackgroundTerminal,
} from "./localConversationBackgroundTerminalSignals";
import { BackgroundTerminalList } from "./BackgroundTerminalList";

interface ThreadSummaryPanelProps extends Pick<
  MessageListProps,
  "onOpenSubagentSession" | "onFileClick" | "onOpenArtifactFromTimeline"
> {
  threadId?: string | null;
  turns?: MessageListProps["turns"];
  threadItems?: readonly AgentThreadItem[];
  onOpenBackgroundTerminal?: (terminal: BackgroundTerminal) => void;
  onRefresh?: () => void | Promise<unknown>;
  canonicalChildren?: readonly CanonicalChildThreadSummary[];
  persistenceError?: boolean;
  projectless?: boolean;
  onOpenPluginDirectory?: () => void;
  onOpenChanges?: () => void;
}

export function ThreadSummaryPanel({
  threadId,
  projectless = false,
  onOpenPluginDirectory,
  onOpenChanges,
  turns = [],
  threadItems = [],
  onOpenBackgroundTerminal,
  onRefresh,
  canonicalChildren = [],
  persistenceError,
  onOpenSubagentSession,
  onFileClick,
  onOpenArtifactFromTimeline,
}: ThreadSummaryPanelProps) {
  const { t } = useTranslation("agent");
  const summary = selectThreadSummary(threadItems);
  const backgroundTerminals = selectBackgroundTerminals(
    threadId,
    turns,
    threadItems,
  );
  const plan = summary.plan;
  const changedFilesByPath = new Map<
    string,
    { additions: number; removals: number }
  >();
  for (const item of threadItems) {
    if (item.type !== "patch") continue;
    const part = buildTimelinePatchContentPart(item);
    if (!part || part.type !== "file_changes_batch") continue;
    for (const file of part.aggregate.files) {
      const dedupeKey = file.path.split("/").filter(Boolean).pop() ?? file.path;
      changedFilesByPath.set(dedupeKey, {
        additions: file.linesAdded,
        removals: file.linesRemoved,
      });
    }
  }
  const changeStats = {
    fileCount: changedFilesByPath.size,
    additions: [...changedFilesByPath.values()].reduce(
      (total, file) => total + file.additions,
      0,
    ),
    removals: [...changedFilesByPath.values()].reduce(
      (total, file) => total + file.removals,
      0,
    ),
  };
  if (
    !persistenceError &&
    !summary.outputs.length &&
    !plan &&
    !canonicalChildren.length &&
    !backgroundTerminals.length &&
    !summary.hasWebSearch &&
    !projectless &&
    changeStats.fileCount === 0
  )
    return null;
  const text = (key: string) => String(t(`agentChat.summary.${key}`));
  return (
    <div
      className="flex max-h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] shadow-sm"
      data-testid="thread-summary-panel"
      data-summary-panel-variant="summary"
    >
      <div className="flex min-h-0 flex-col gap-2 overflow-x-hidden overflow-y-auto py-2.5">
        {persistenceError ? (
          <p
            role="status"
            className="px-5 text-xs text-[color:var(--lime-text-muted)]"
          >
            {text("saveError")}
          </p>
        ) : null}
        {changeStats.fileCount > 0 ? (
          <SummarySection
            sectionKey="changes"
            title={text("changes")}
            count={changeStats.fileCount}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 px-5 font-mono text-[12px] text-left enabled:hover:text-[color:var(--lime-text-strong)] disabled:cursor-default"
              data-testid="thread-summary-change-stats"
              data-file-count={changeStats.fileCount}
              onClick={() => {
                if (onOpenChanges) {
                  onOpenChanges();
                  return;
                }
                requestOpenChangesSurface();
              }}
              title={String(t("agentChat.summary.openChanges"))}
            >
              {changeStats.additions > 0 || changeStats.removals > 0 ? (
                <>
                  <span className="text-[color:var(--lime-diff-add-border)]">
                    +{changeStats.additions}
                  </span>
                  <span className="text-[color:var(--lime-diff-remove-border)]">
                    -{changeStats.removals}
                  </span>
                </>
              ) : null}
            </button>
          </SummarySection>
        ) : null}
        {summary.outputs.length ? (
          <SummarySection
            sectionKey="outputs"
            title={text("outputs")}
            count={summary.outputs.length}
          >
            {summary.outputs.map(({ rootTarget, title }) => (
              <SummaryRow
                key={rootTarget.filePath}
                icon={
                  <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                }
                label={title || rootTarget.filePath}
                onClick={
                  onOpenArtifactFromTimeline
                    ? () => onOpenArtifactFromTimeline(rootTarget)
                    : onFileClick
                      ? () =>
                          onFileClick(rootTarget.filePath, rootTarget.content)
                      : undefined
                }
              />
            ))}
          </SummarySection>
        ) : null}
        {plan ? (
          <SummarySection sectionKey="plan" title={text("plan")}>
            <SummaryRow
              icon={
                <ListChecks className="h-4 w-4 shrink-0" aria-hidden="true" />
              }
              label={text("plan")}
              onClick={
                onFileClick
                  ? () => onFileClick("plan.md", plan.text)
                  : undefined
              }
            />
          </SummarySection>
        ) : null}
        {canonicalChildren.length ? (
          <SummarySection
            sectionKey="background-subagents"
            title={text("subagents")}
            count={canonicalChildren.length}
          >
            {canonicalChildren.map((child) => (
              <SummaryRow
                key={child.threadId}
                icon={<Bot className="h-4 w-4 shrink-0" aria-hidden="true" />}
                label={child.name}
                detail={String(t(`agentChat.summary.status.${child.status}`))}
                onClick={
                  onOpenSubagentSession
                    ? () => onOpenSubagentSession(child.threadId)
                    : undefined
                }
              />
            ))}
          </SummarySection>
        ) : null}
        {threadId && backgroundTerminals.length ? (
          <SummarySection
            sectionKey="background-tasks"
            title={text("processes")}
            count={backgroundTerminals.length}
          >
            <BackgroundTerminalList
              key={threadId}
              threadId={threadId}
              terminals={backgroundTerminals}
              onOpenTerminal={onOpenBackgroundTerminal}
              onRefresh={onRefresh}
            />
          </SummarySection>
        ) : null}
        <ThreadSources
          key={threadId}
          threadId={threadId}
          projectless={projectless}
          hasWebSearch={summary.hasWebSearch}
          onOpenPluginDirectory={onOpenPluginDirectory}
        />
      </div>
    </div>
  );
}
