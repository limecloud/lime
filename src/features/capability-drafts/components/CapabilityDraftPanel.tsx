import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, RefreshCw } from "lucide-react";
import {
  capabilityDraftsApi,
  type CapabilityDraftRecord,
} from "@/lib/api/capabilityDrafts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  canVerifyCapabilityDraft,
  canExecuteCapabilityDraft,
  canRegisterCapabilityDraft,
  getCapabilityDraftStatusPresentation,
  summarizeCapabilityDraftFailedChecks,
  summarizeCapabilityDraftFiles,
  summarizeCapabilityDraftPermissions,
  summarizeCapabilityDraftRegistration,
  summarizeCapabilityDraftVerification,
} from "../domain/capabilityDraftPresentation";

interface CapabilityDraftPanelProps {
  workspaceRoot?: string | null;
  projectPending?: boolean;
  projectError?: string | null;
  highlightedDraftId?: string | null;
  onRegisteredSkillsChanged?: () => void;
  className?: string;
}

const STATUS_TONE_CLASSNAMES = {
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  slate: "border-slate-200 bg-slate-50 text-slate-600",
};

function sortDraftsForDisplay(
  drafts: CapabilityDraftRecord[],
  highlightedDraftId?: string | null,
): CapabilityDraftRecord[] {
  const normalizedHighlight = highlightedDraftId?.trim();
  return [...drafts].sort((left, right) => {
    const leftHighlighted =
      normalizedHighlight && left.draftId === normalizedHighlight ? 1 : 0;
    const rightHighlighted =
      normalizedHighlight && right.draftId === normalizedHighlight ? 1 : 0;
    if (leftHighlighted !== rightHighlighted) {
      return rightHighlighted - leftHighlighted;
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

export function CapabilityDraftPanel({
  workspaceRoot,
  projectPending = false,
  projectError,
  highlightedDraftId,
  onRegisteredSkillsChanged,
  className,
}: CapabilityDraftPanelProps) {
  const [drafts, setDrafts] = useState<CapabilityDraftRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyingDraftId, setVerifyingDraftId] = useState<string | null>(null);
  const [registeringDraftId, setRegisteringDraftId] = useState<string | null>(
    null,
  );
  const [verificationMessage, setVerificationMessage] = useState<string | null>(
    null,
  );
  const [registrationMessage, setRegistrationMessage] = useState<string | null>(
    null,
  );
  const normalizedWorkspaceRoot = workspaceRoot?.trim() || null;

  const loadDrafts = useCallback(async () => {
    if (!normalizedWorkspaceRoot) {
      setDrafts([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextDrafts = await capabilityDraftsApi.list({
        workspaceRoot: normalizedWorkspaceRoot,
      });
      setDrafts(nextDrafts);
    } catch (loadError) {
      setDrafts([]);
      setError(String(loadError));
    } finally {
      setLoading(false);
    }
  }, [normalizedWorkspaceRoot]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!normalizedWorkspaceRoot) {
        setDrafts([]);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const nextDrafts = await capabilityDraftsApi.list({
          workspaceRoot: normalizedWorkspaceRoot,
        });
        if (!cancelled) {
          setDrafts(nextDrafts);
        }
      } catch (loadError) {
        if (!cancelled) {
          setDrafts([]);
          setError(String(loadError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [normalizedWorkspaceRoot]);

  const visibleDrafts = useMemo(
    () => sortDraftsForDisplay(drafts, highlightedDraftId).slice(0, 3),
    [drafts, highlightedDraftId],
  );

  const effectiveError = projectError || error;
  const isBusy = projectPending || loading;

  const handleVerifyDraft = useCallback(
    async (draft: CapabilityDraftRecord) => {
      if (!normalizedWorkspaceRoot || verifyingDraftId) {
        return;
      }

      setVerifyingDraftId(draft.draftId);
      setError(null);
      setVerificationMessage(null);
      setRegistrationMessage(null);
      try {
        const result = await capabilityDraftsApi.verify({
          workspaceRoot: normalizedWorkspaceRoot,
          draftId: draft.draftId,
        });
        setDrafts((current) =>
          current.map((item) =>
            item.draftId === result.draft.draftId ? result.draft : item,
          ),
        );
        setVerificationMessage(
          `${result.report.summary} ${summarizeCapabilityDraftFailedChecks(
            result.report,
          )}`,
        );
      } catch (verifyError) {
        setError(String(verifyError));
      } finally {
        setVerifyingDraftId(null);
      }
    },
    [normalizedWorkspaceRoot, verifyingDraftId],
  );

  const handleRegisterDraft = useCallback(
    async (draft: CapabilityDraftRecord) => {
      if (!normalizedWorkspaceRoot || registeringDraftId) {
        return;
      }

      setRegisteringDraftId(draft.draftId);
      setError(null);
      setVerificationMessage(null);
      setRegistrationMessage(null);
      try {
        const result = await capabilityDraftsApi.register({
          workspaceRoot: normalizedWorkspaceRoot,
          draftId: draft.draftId,
        });
        setDrafts((current) =>
          current.map((item) =>
            item.draftId === result.draft.draftId ? result.draft : item,
          ),
        );
        setRegistrationMessage(
          `已注册到当前 Workspace：${result.registration.skillDirectory}。运行与自动化仍需后续 runtime gate。`,
        );
        onRegisteredSkillsChanged?.();
      } catch (registerError) {
        setError(String(registerError));
      } finally {
        setRegisteringDraftId(null);
      }
    },
    [normalizedWorkspaceRoot, onRegisteredSkillsChanged, registeringDraftId],
  );

  return (
    <section
      className={cn(
        "rounded-[28px] border border-amber-200/80 bg-white p-5 shadow-sm shadow-amber-950/5",
        className,
      )}
      data-testid="capability-draft-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
              草案区
            </span>
            <h2 className="text-[15px] font-semibold text-slate-900">
              能力草案
            </h2>
          </div>
          <p className="text-[11px] leading-5 text-slate-500">
            Coding Agent
            产出的 Skill 草案先停在这里；未验证前不会注册，也不会自动运行。
          </p>
        </div>
        {normalizedWorkspaceRoot ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-2xl px-3 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            onClick={() => void loadDrafts()}
            disabled={isBusy}
            data-testid="capability-draft-refresh"
          >
            <RefreshCw
              className={cn("mr-1.5 h-3.5 w-3.5", isBusy && "animate-spin")}
            />
            刷新
          </Button>
        ) : null}
      </div>

      {!normalizedWorkspaceRoot ? (
        <div className="mt-4 rounded-[22px] border border-dashed border-amber-200 bg-amber-50/60 px-4 py-5 text-sm leading-6 text-amber-800">
          选择或进入一个项目后，才能查看该项目里的能力草案。
        </div>
      ) : effectiveError ? (
        <div className="mt-4 rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-5 text-sm leading-6 text-rose-700">
          能力草案暂时没读到：{effectiveError}
        </div>
      ) : isBusy ? (
        <div className="mt-4 rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-5 text-sm leading-6 text-slate-500">
          正在读取能力草案...
        </div>
      ) : visibleDrafts.length === 0 ? (
        <div className="mt-4 rounded-[22px] border border-dashed border-amber-200 bg-amber-50/60 px-4 py-5 text-sm leading-6 text-amber-800">
          当前项目还没有能力草案。后续 Coding Agent
          生成的新能力会先进入这里复核。
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {visibleDrafts.map((draft) => {
            const status = getCapabilityDraftStatusPresentation(
              draft.verificationStatus,
            );
            const canRun = canExecuteCapabilityDraft(draft);
            const canRegister = canRegisterCapabilityDraft(draft);
            const canVerify = canVerifyCapabilityDraft(draft);
            const isVerifying = verifyingDraftId === draft.draftId;
            const isRegistering = registeringDraftId === draft.draftId;

            return (
              <article
                key={draft.draftId}
                className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                      STATUS_TONE_CLASSNAMES[status.tone],
                    )}
                  >
                    {status.label}
                  </span>
                  <span className="text-[11px] leading-5 text-slate-400">
                    {draft.sourceKind || "manual"}
                  </span>
                </div>
                <div className="mt-2.5 space-y-1.5">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {draft.name}
                  </h3>
                  <p className="line-clamp-2 text-[12px] leading-5 text-slate-600">
                    {draft.description || draft.userGoal}
                  </p>
                </div>
                <div className="mt-3 space-y-1 text-[11px] leading-5 text-slate-500">
                  <div>
                    <span className="font-medium text-slate-700">目标：</span>
                    {draft.userGoal}
                  </div>
                  <div>
                    <span className="font-medium text-slate-700">权限：</span>
                    {summarizeCapabilityDraftPermissions(draft)}
                  </div>
                  <div>
                    <span className="font-medium text-slate-700">文件：</span>
                    {summarizeCapabilityDraftFiles(draft)}
                  </div>
                  <div>
                    <span className="font-medium text-slate-700">验证：</span>
                    {summarizeCapabilityDraftVerification(draft)}
                  </div>
                  <div>
                    <span className="font-medium text-slate-700">注册：</span>
                    {summarizeCapabilityDraftRegistration(draft)}
                  </div>
                  <div className="text-amber-700">
                    {status.description}
                    {!canRun &&
                    !canRegister &&
                    draft.verificationStatus !== "registered"
                      ? " 当前没有运行、注册或自动化入口。"
                      : null}
                    {canRegister
                      ? " 注册只会复制为 Workspace 本地 Skill，不会立即运行。"
                      : null}
                    {draft.verificationStatus === "registered"
                      ? " 当前没有运行或自动化入口。"
                      : null}
                  </div>
                </div>
                {canVerify || canRegister ? (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 pt-3">
                    <p className="text-[11px] leading-5 text-slate-500">
                      {canRegister
                        ? "注册只写当前 Workspace 的 .agents/skills，不接运行或自动化。"
                        : "只做静态门禁检查，不执行草案脚本。"}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {canVerify ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-2xl border-amber-200 bg-white px-3 text-amber-800 hover:bg-amber-50"
                          onClick={() => void handleVerifyDraft(draft)}
                          disabled={
                            isBusy ||
                            Boolean(verifyingDraftId) ||
                            Boolean(registeringDraftId)
                          }
                        >
                          <RefreshCw
                            className={cn(
                              "mr-1.5 h-3.5 w-3.5",
                              isVerifying && "animate-spin",
                            )}
                          />
                          运行验证
                        </Button>
                      ) : null}
                      {canRegister ? (
                        <Button
                          type="button"
                          size="sm"
                          className="rounded-2xl bg-slate-900 px-3 text-white hover:bg-slate-800"
                          onClick={() => void handleRegisterDraft(draft)}
                          disabled={
                            isBusy ||
                            Boolean(verifyingDraftId) ||
                            Boolean(registeringDraftId)
                          }
                        >
                          <CheckCircle2
                            className={cn(
                              "mr-1.5 h-3.5 w-3.5",
                              isRegistering && "animate-pulse",
                            )}
                          />
                          注册到 Workspace
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {verificationMessage ? (
        <div className="mt-3 rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-600">
          {verificationMessage}
        </div>
      ) : null}
      {registrationMessage ? (
        <div className="mt-3 rounded-[18px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] leading-5 text-emerald-700">
          {registrationMessage}
        </div>
      ) : null}
    </section>
  );
}
