import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GitFork } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type ForkFromTurnMode = "local" | "worktree";

export function ForkFromTurnDialog({
  open,
  onOpenChange,
  onConfirm,
  worktreeAvailable = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (mode: ForkFromTurnMode) => void;
  worktreeAvailable?: boolean;
}) {
  const { t } = useTranslation("agent");
  const [mode, setMode] = useState<ForkFromTurnMode>("local");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[480px]"
        data-testid="fork-from-turn-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {String(
              t("agentChat.forkFromOlderTurn.title", {
                defaultValue: "从这里创建聊天分支",
              }),
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <button
            type="button"
            className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
              mode === "local"
                ? "border-[color:var(--lime-brand)] bg-[color:var(--lime-brand-soft)]"
                : "border-[color:var(--lime-surface-border)]"
            }`}
            data-testid="fork-from-turn-use-local"
            aria-pressed={mode === "local"}
            onClick={() => setMode("local")}
          >
            <GitFork className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--lime-text-muted)]" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">
                {String(
                  t("agentChat.forkFromOlderTurn.local", {
                    defaultValue: "使用此工作空间",
                  }),
                )}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {String(
                  t("agentChat.forkFromOlderTurn.localDescription", {
                    defaultValue: "两个聊天共用同一组文件",
                  }),
                )}
              </span>
            </span>
          </button>
          <button
            type="button"
            disabled={!worktreeAvailable}
            className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              mode === "worktree"
                ? "border-[color:var(--lime-brand)] bg-[color:var(--lime-brand-soft)]"
                : "border-[color:var(--lime-surface-border)]"
            }`}
            data-testid="fork-from-turn-use-worktree"
            aria-pressed={mode === "worktree"}
            onClick={() => setMode("worktree")}
          >
            <GitFork className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--lime-text-muted)]" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">
                {String(
                  t("agentChat.forkFromOlderTurn.worktree", {
                    defaultValue: "创建新工作树",
                  }),
                )}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {String(
                  t("agentChat.forkFromOlderTurn.worktreeDescription", {
                    defaultValue: "新聊天将拥有独立的工作目录",
                  }),
                )}
              </span>
            </span>
          </button>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {String(
              t("agentChat.forkFromOlderTurn.cancel", {
                defaultValue: "取消",
              }),
            )}
          </Button>
          <Button
            type="button"
            data-testid="fork-from-turn-confirm"
            onClick={() => onConfirm(mode)}
          >
            {String(
              t("agentChat.forkFromOlderTurn.confirm", {
                defaultValue: "创建聊天分支",
              }),
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
