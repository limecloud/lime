import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  FileJson,
  FileText,
  GitCompare,
  Loader2,
} from "lucide-react";

import {
  diffAgentRuntimeFileCheckpoint,
  getAgentRuntimeFileCheckpoint,
  listAgentRuntimeFileCheckpoints,
  type AgentRuntimeFileCheckpointDetail,
  type AgentRuntimeFileCheckpointDiffResult,
  type AgentRuntimeFileCheckpointListResult,
} from "@/lib/api/agentRuntime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface AsyncState<T> {
  status: "idle" | "loading" | "ready" | "error";
  data: T | null;
  error: string | null;
}

interface AgentThreadFileCheckpointDialogProps {
  open: boolean;
  sessionId: string;
  workingDir?: string | null;
  defaultCheckpointId?: string | null;
  onOpenChange: (open: boolean) => void;
}

function createAsyncState<T>(
  status: AsyncState<T>["status"],
  data: T | null = null,
  error: string | null = null,
): AsyncState<T> {
  return {
    status,
    data,
    error,
  };
}

function parseDiagnosticDate(value?: string | number | null): Date | null {
  if (typeof value === "number") {
    const normalizedValue = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(normalizedValue);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function formatDiagnosticDateTime(
  value?: string | number | null,
): string | null {
  const date = parseDiagnosticDate(value);
  if (!date) {
    return null;
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizePreviewText(
  value?: string | null,
  maxLength = 140,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function serializePreviewValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value == null) {
    return "暂无可展示内容";
  }

  return JSON.stringify(
    value,
    (_key, item) => (item instanceof Date ? item.toISOString() : item),
    2,
  );
}

function resolveCheckpointVersionLabel(versionNo?: number): string | null {
  return typeof versionNo === "number" ? `v${versionNo}` : null;
}

export function AgentThreadFileCheckpointDialog({
  open,
  sessionId,
  workingDir,
  defaultCheckpointId,
  onOpenChange,
}: AgentThreadFileCheckpointDialogProps) {
  const [listState, setListState] = useState<
    AsyncState<AgentRuntimeFileCheckpointListResult>
  >(createAsyncState<AgentRuntimeFileCheckpointListResult>("idle"));
  const [detailState, setDetailState] = useState<
    AsyncState<AgentRuntimeFileCheckpointDetail>
  >(createAsyncState<AgentRuntimeFileCheckpointDetail>("idle"));
  const [diffState, setDiffState] = useState<
    AsyncState<AgentRuntimeFileCheckpointDiffResult>
  >(createAsyncState<AgentRuntimeFileCheckpointDiffResult>("idle"));
  const [selectedCheckpointId, setSelectedCheckpointId] = useState("");

  useEffect(() => {
    if (!open || !sessionId) {
      return;
    }

    let cancelled = false;
    setListState(createAsyncState<AgentRuntimeFileCheckpointListResult>("loading"));
    setDetailState(createAsyncState<AgentRuntimeFileCheckpointDetail>("idle"));
    setDiffState(createAsyncState<AgentRuntimeFileCheckpointDiffResult>("idle"));
    setSelectedCheckpointId("");

    void listAgentRuntimeFileCheckpoints({
      session_id: sessionId,
    })
      .then((result) => {
        if (cancelled) {
          return;
        }

        const checkpoints = result.checkpoints || [];
        const defaultCheckpoint =
          checkpoints.find(
            (checkpoint) => checkpoint.checkpoint_id === defaultCheckpointId,
          ) || checkpoints[0] || null;

        setListState(
          createAsyncState<AgentRuntimeFileCheckpointListResult>(
            "ready",
            result,
          ),
        );
        setSelectedCheckpointId(defaultCheckpoint?.checkpoint_id || "");
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setListState(
          createAsyncState<AgentRuntimeFileCheckpointListResult>(
            "error",
            null,
            error instanceof Error
              ? error.message
              : "文件快照列表加载失败，请稍后重试",
          ),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [defaultCheckpointId, open, sessionId]);

  useEffect(() => {
    if (!open || !sessionId || !selectedCheckpointId) {
      return;
    }

    let cancelled = false;
    setDetailState(createAsyncState<AgentRuntimeFileCheckpointDetail>("loading"));
    setDiffState(createAsyncState<AgentRuntimeFileCheckpointDiffResult>("loading"));

    void Promise.allSettled([
      getAgentRuntimeFileCheckpoint({
        session_id: sessionId,
        checkpoint_id: selectedCheckpointId,
      }),
      diffAgentRuntimeFileCheckpoint({
        session_id: sessionId,
        checkpoint_id: selectedCheckpointId,
      }),
    ]).then(([detailResult, diffResult]) => {
      if (cancelled) {
        return;
      }

      if (detailResult.status === "fulfilled") {
        setDetailState(
          createAsyncState<AgentRuntimeFileCheckpointDetail>(
            "ready",
            detailResult.value,
          ),
        );
      } else {
        setDetailState(
          createAsyncState<AgentRuntimeFileCheckpointDetail>(
            "error",
            null,
            detailResult.reason instanceof Error
              ? detailResult.reason.message
              : "文件快照详情加载失败，请稍后重试",
          ),
        );
      }

      if (diffResult.status === "fulfilled") {
        setDiffState(
          createAsyncState<AgentRuntimeFileCheckpointDiffResult>(
            "ready",
            diffResult.value,
          ),
        );
      } else {
        setDiffState(
          createAsyncState<AgentRuntimeFileCheckpointDiffResult>(
            "error",
            null,
            diffResult.reason instanceof Error
              ? diffResult.reason.message
              : "文件快照差异加载失败，请稍后重试",
          ),
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [open, selectedCheckpointId, sessionId]);

  const checkpoints = listState.data?.checkpoints ?? [];
  const selectedCheckpoint =
    checkpoints.find(
      (checkpoint) => checkpoint.checkpoint_id === selectedCheckpointId,
    ) || null;
  const documentPreviewTitle = detailState.data?.checkpoint_document
    ? "快照文档 JSON"
    : detailState.data?.live_document
      ? "当前文档 JSON"
      : detailState.data?.content
        ? "快照原文"
        : "快照内容";
  const documentPreviewValue =
    detailState.data?.checkpoint_document ??
    detailState.data?.live_document ??
    detailState.data?.content ??
    null;
  const diffPreviewValue = diffState.data?.diff ?? null;
  const detailLoading =
    detailState.status === "loading" || diffState.status === "loading";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent maxWidth="max-w-6xl" className="p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="pr-8">文件快照详情</DialogTitle>
          <DialogDescription className="space-y-1 text-xs leading-5">
            <span className="block">
              当前弹窗直接消费 runtime file checkpoint 的 current 主链：
              `list / detail / diff`。
            </span>
            <span className="block font-mono text-[11px] text-muted-foreground">
              session={sessionId}
            </span>
            {workingDir ? (
              <span className="block font-mono text-[11px] text-muted-foreground">
                workspace={workingDir}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div
          className="grid gap-4 px-6 py-5 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]"
          data-testid="agent-thread-file-checkpoint-dialog"
        >
          <section className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-slate-900">
                  快照版本列表
                </div>
                {typeof listState.data?.checkpoint_count === "number" ? (
                  <Badge
                    variant="outline"
                    className="border-slate-200 bg-white text-slate-700"
                  >
                    共 {listState.data.checkpoint_count} 个
                  </Badge>
                ) : null}
                {listState.status === "loading" ? (
                  <Badge
                    variant="outline"
                    className="border-sky-200 bg-white text-sky-700"
                  >
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    正在拉取列表
                  </Badge>
                ) : null}
              </div>

              {listState.status === "error" ? (
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm leading-6 text-rose-700">
                  {listState.error}
                </div>
              ) : checkpoints.length > 0 ? (
                <div
                  className="mt-3 max-h-[60vh] space-y-2 overflow-y-auto pr-1"
                  data-testid="agent-thread-file-checkpoint-list"
                >
                  {checkpoints.map((checkpoint) => {
                    const versionLabel = resolveCheckpointVersionLabel(
                      checkpoint.version_no,
                    );
                    const updatedAtLabel = formatDiagnosticDateTime(
                      checkpoint.updated_at,
                    );
                    const previewText = normalizePreviewText(
                      checkpoint.preview_text,
                    );
                    const isSelected =
                      checkpoint.checkpoint_id === selectedCheckpointId;

                    return (
                      <button
                        key={checkpoint.checkpoint_id}
                        type="button"
                        className={cn(
                          "w-full rounded-2xl border px-3 py-3 text-left transition-colors",
                          isSelected
                            ? "border-sky-300 bg-sky-50"
                            : "border-slate-200 bg-white hover:border-sky-200 hover:bg-sky-50/60",
                        )}
                        onClick={() =>
                          setSelectedCheckpointId(checkpoint.checkpoint_id)
                        }
                        data-testid={`agent-thread-file-checkpoint-item-${checkpoint.checkpoint_id}`}
                      >
                        <div className="text-sm font-medium leading-6 text-slate-900">
                          {checkpoint.path}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          {versionLabel ? (
                            <Badge
                              variant="outline"
                              className="border-slate-200 bg-white text-slate-700"
                            >
                              {versionLabel}
                            </Badge>
                          ) : null}
                          {checkpoint.validation_issue_count > 0 ? (
                            <Badge
                              variant="outline"
                              className="border-amber-200 bg-amber-50 text-amber-700"
                            >
                              校验问题 {checkpoint.validation_issue_count}
                            </Badge>
                          ) : null}
                          {checkpoint.status ? (
                            <Badge
                              variant="outline"
                              className="border-slate-200 bg-white text-slate-700"
                            >
                              {checkpoint.status}
                            </Badge>
                          ) : null}
                        </div>
                        {previewText ? (
                          <div className="mt-2 text-xs leading-5 text-slate-600">
                            {previewText}
                          </div>
                        ) : null}
                        <div className="mt-2 text-[11px] leading-5 text-slate-500">
                          {updatedAtLabel
                            ? `更新时间 ${updatedAtLabel}`
                            : "更新时间未知"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : listState.status === "ready" ? (
                <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-white px-3 py-4 text-sm leading-6 text-slate-600">
                  当前线程还没有可展示的文件快照版本。
                </div>
              ) : null}
            </div>
          </section>

          <section className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                      <FileText className="h-4 w-4 text-sky-700" />
                      <span>当前快照</span>
                    </div>
                    {selectedCheckpoint ? (
                      <Badge
                        variant="outline"
                        className="border-slate-200 bg-slate-50 text-slate-700"
                      >
                        {resolveCheckpointVersionLabel(
                          selectedCheckpoint.version_no,
                        ) || "未标版本"}
                      </Badge>
                    ) : null}
                    {detailLoading ? (
                      <Badge
                        variant="outline"
                        className="border-sky-200 bg-sky-50 text-sky-700"
                      >
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        正在同步 detail / diff
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-2 break-all text-sm leading-6 text-slate-900">
                    {selectedCheckpoint?.path || "请选择左侧文件快照"}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {selectedCheckpoint?.title ? (
                  <Badge
                    variant="outline"
                    className="border-slate-200 bg-slate-50 text-slate-700"
                  >
                    标题 {selectedCheckpoint.title}
                  </Badge>
                ) : null}
                {selectedCheckpoint?.source ? (
                  <Badge
                    variant="outline"
                    className="border-slate-200 bg-slate-50 text-slate-700"
                  >
                    来源 {selectedCheckpoint.source}
                  </Badge>
                ) : null}
                {selectedCheckpoint?.kind ? (
                  <Badge
                    variant="outline"
                    className="border-slate-200 bg-slate-50 text-slate-700"
                  >
                    类型 {selectedCheckpoint.kind}
                  </Badge>
                ) : null}
                {selectedCheckpoint?.status ? (
                  <Badge
                    variant="outline"
                    className="border-slate-200 bg-slate-50 text-slate-700"
                  >
                    状态 {selectedCheckpoint.status}
                  </Badge>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
              <div
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                data-testid="agent-thread-file-checkpoint-detail"
              >
                <div className="text-sm font-medium text-slate-900">
                  快照信息
                </div>
                {detailState.status === "error" ? (
                  <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm leading-6 text-rose-700">
                    {detailState.error}
                  </div>
                ) : detailState.data ? (
                  <div className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                    <div>live_path：{detailState.data.live_path}</div>
                    <div>snapshot_path：{detailState.data.snapshot_path}</div>
                    <div>
                      version_history：{detailState.data.version_history.length}
                    </div>
                    <div>
                      request_id：
                      {detailState.data.checkpoint.request_id || "无"}
                    </div>
                    <div>
                      最近更新时间：
                      {formatDiagnosticDateTime(
                        detailState.data.checkpoint.updated_at,
                      ) || "未知"}
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 text-sm leading-6 text-slate-600">
                    选中快照后会在这里显示基础信息。
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span>版本与校验</span>
                </div>
                {detailState.status === "error" ? (
                  <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm leading-6 text-rose-700">
                    {detailState.error}
                  </div>
                ) : detailState.data || diffState.data ? (
                  <div className="mt-3 space-y-3 text-sm leading-6 text-slate-700">
                    <div className="flex flex-wrap gap-2">
                      {diffState.data?.previous_version_id ? (
                        <Badge
                          variant="outline"
                          className="border-slate-200 bg-white text-slate-700"
                        >
                          previous {diffState.data.previous_version_id}
                        </Badge>
                      ) : null}
                      {diffState.data?.current_version_id ? (
                        <Badge
                          variant="outline"
                          className="border-slate-200 bg-white text-slate-700"
                        >
                          current {diffState.data.current_version_id}
                        </Badge>
                      ) : null}
                    </div>
                    {detailState.data?.validation_issues.length ? (
                      <div className="space-y-2">
                        {detailState.data.validation_issues.map((issue) => (
                          <div
                            key={issue}
                            className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800"
                          >
                            {issue}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-slate-600">无校验问题</div>
                    )}
                    {diffState.status === "error" ? (
                      <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-rose-700">
                        {diffState.error}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-3 text-sm leading-6 text-slate-600">
                    detail / diff 返回后会在这里展示版本锚点与校验结果。
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-900">
                <FileJson className="h-4 w-4 text-sky-700" />
                <span>{documentPreviewTitle}</span>
              </div>
              <div className="max-h-[24vh] overflow-y-auto px-4 py-4">
                <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-6 text-slate-700">
                  {serializePreviewValue(documentPreviewValue)}
                </pre>
              </div>
            </div>

            <div
              className="rounded-2xl border border-slate-200 bg-white"
              data-testid="agent-thread-file-checkpoint-diff"
            >
              <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-900">
                <GitCompare className="h-4 w-4 text-sky-700" />
                <span>Diff 预览</span>
              </div>
              <div className="max-h-[24vh] overflow-y-auto px-4 py-4">
                <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-6 text-slate-700">
                  {serializePreviewValue(diffPreviewValue)}
                </pre>
              </div>
            </div>
          </section>
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AgentThreadFileCheckpointDialog;
