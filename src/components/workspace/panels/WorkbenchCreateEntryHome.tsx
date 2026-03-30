import { useEffect, useState } from "react";
import { FolderOpen, LayoutTemplate, PenTool, Sparkles } from "lucide-react";
import { A2UIRenderer } from "@/lib/workspace/a2ui";
import type {
  A2UIFormData,
  A2UIResponse,
} from "@/lib/workspace/a2ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CREATE_CONFIRMATION_FORM_FIELDS,
  type PendingCreateConfirmation,
} from "@/components/workspace/utils/createConfirmationPolicy";

export interface WorkbenchCreateEntryHomeProps {
  projectName?: string;
  pendingCreateConfirmation?: PendingCreateConfirmation;
  createConfirmationResponse: A2UIResponse | null;
  onOpenCreateContentDialog: () => void;
  onSubmitCreateConfirmation?: (formData: A2UIFormData) => Promise<void> | void;
  onCancelCreateConfirmation?: () => void;
}

const CREATION_MODE_LABELS: Record<string, string> = {
  guided: "引导模式",
  fast: "快速模式",
  hybrid: "混合模式",
  framework: "框架模式",
};

const SOURCE_LABELS: Record<PendingCreateConfirmation["source"], string> = {
  project_created: "新项目已创建",
  open_project_for_writing: "准备开始创作",
  workspace_create_entry: "创作首页",
  workspace_prompt: "已接收你的提示",
  quick_create: "快捷创建",
};

export function WorkbenchCreateEntryHome({
  projectName,
  pendingCreateConfirmation,
  createConfirmationResponse,
  onOpenCreateContentDialog,
  onSubmitCreateConfirmation,
  onCancelCreateConfirmation,
}: WorkbenchCreateEntryHomeProps) {
  const [confirmationFormData, setConfirmationFormData] =
    useState<A2UIFormData>({});

  useEffect(() => {
    setConfirmationFormData({});
  }, [createConfirmationResponse?.id]);

  const hasPendingTask = Boolean(createConfirmationResponse);
  const promptPreview =
    pendingCreateConfirmation?.initialUserPrompt?.trim() || "";

  const sourceLabel = pendingCreateConfirmation
    ? SOURCE_LABELS[pendingCreateConfirmation.source]
    : "创作首页";

  const creationModeLabel = pendingCreateConfirmation
    ? CREATION_MODE_LABELS[pendingCreateConfirmation.creationMode] ||
      pendingCreateConfirmation.creationMode
    : null;

  const selectedOptionRaw =
    confirmationFormData[CREATE_CONFIRMATION_FORM_FIELDS.option];
  const selectedOption = Array.isArray(selectedOptionRaw)
    ? selectedOptionRaw[0]
    : selectedOptionRaw;
  const noteValue = String(
    confirmationFormData[CREATE_CONFIRMATION_FORM_FIELDS.note] || "",
  ).trim();

  const canSubmitTask = Boolean(
    selectedOption && (selectedOption !== "other" || noteValue.length >= 2),
  );

  return (
    <div
      className="relative flex-1 min-h-0 flex flex-col items-center justify-center p-6 md:p-12 overflow-y-auto bg-slate-50 dark:bg-[#0B0C10] transition-colors"
      data-testid="workspace-create-entry-home"
    >
      {/* Premium Ambient Backgrounds */}
      <div className="absolute top-[-10%] left-[20%] w-[600px] h-[600px] bg-[radial-gradient(circle,hsl(var(--primary)/0.08)_0%,transparent_70%)] rounded-full pointer-events-none blur-3xl opacity-60 dark:opacity-40" />
      <div className="absolute bottom-[-10%] right-[10%] w-[500px] h-[500px] bg-[radial-gradient(circle,hsl(var(--primary)/0.05)_0%,transparent_70%)] rounded-full pointer-events-none blur-3xl opacity-50 dark:opacity-30" />

      <div className="w-full max-w-[800px] relative z-10 flex flex-col items-center gap-10 animate-in fade-in slide-in-from-bottom-6 duration-700 zoom-in-95 ease-out">
        {/* Header Section */}
        <div className="text-center space-y-6">
          <div className="flex justify-center flex-wrap items-center gap-2.5">
            {projectName && (
              <Badge
                variant="outline"
                className="border-slate-200/60 bg-white/60 dark:border-white/10 dark:bg-white/5 backdrop-blur-md text-slate-700 dark:text-slate-200 font-medium px-4 py-1.5 shadow-sm"
              >
                <FolderOpen className="w-3.5 h-3.5 mr-1.5 text-primary" />
                {projectName}
              </Badge>
            )}
            <Badge
              variant="secondary"
              className="bg-primary/10 text-primary dark:bg-primary/20 hover:bg-primary/20 transition-colors font-medium px-4 py-1.5 backdrop-blur-md shadow-sm border border-primary/20"
            >
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              {sourceLabel}
            </Badge>
            {creationModeLabel && (
              <Badge
                variant="outline"
                className="border-slate-200/60 bg-white/60 dark:border-white/10 dark:bg-white/5 backdrop-blur-md text-slate-700 dark:text-slate-200 font-medium px-4 py-1.5 shadow-sm"
              >
                <PenTool className="w-3.5 h-3.5 mr-1.5 text-slate-500 dark:text-slate-400" />
                {creationModeLabel}
              </Badge>
            )}
          </div>

          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white drop-shadow-sm">
            {hasPendingTask ? "确认创作方式" : "创作画布已就绪"}
          </h1>
          <p className="text-lg text-slate-500 dark:text-slate-400 max-w-xl mx-auto leading-relaxed">
            {hasPendingTask
              ? "为你准备了以下选项，补充所需信息后我们将立即开始。"
              : "当前没有待处理任务，你可以直接发起创建确认，然后再继续创作。"}
          </p>
        </div>

        {/* Input/Task Card */}
        <div className="w-full relative group">
          <div className="absolute -inset-0.5 bg-gradient-to-br from-primary/30 to-purple-500/30 rounded-[28px] blur-md opacity-20 group-hover:opacity-40 transition duration-500"></div>

          <div
            className="relative w-full bg-white/80 dark:bg-[#15161A]/80 backdrop-blur-xl border border-white/40 dark:border-white/10 rounded-[26px] shadow-2xl overflow-hidden transition-all duration-500"
            data-testid={
              hasPendingTask ? "workspace-create-confirmation-card" : undefined
            }
          >
            {hasPendingTask ? (
              <div className="flex flex-col">
                <div className="p-8 md:p-10 md:pb-8 flex flex-col gap-8">
                  {promptPreview && (
                    <div className="relative rounded-[18px] border border-primary/20 bg-primary/5 p-6 text-sm text-slate-800 dark:text-slate-200 shadow-inner group/prompt">
                      <div className="absolute -top-3 left-6 bg-white dark:bg-[#1A1C21] px-3 py-0.5 text-[11px] font-bold text-primary tracking-widest rounded-full border border-primary/20 shadow-sm flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3" />
                        原始需求
                      </div>
                      <div className="leading-relaxed whitespace-pre-wrap text-[15px]">
                        {promptPreview}
                      </div>
                    </div>
                  )}

                  <A2UIRenderer
                    response={createConfirmationResponse!}
                    className="space-y-6 [&_.a2ui-container_textarea]:min-h-[120px] [&_.a2ui-container_textarea]:text-base [&_.a2ui-container_textarea]:p-4"
                    onFormStateChange={setConfirmationFormData}
                    submitDisabled={!canSubmitTask}
                    submitButtonClassName="w-full h-[56px] text-lg font-bold rounded-2xl mt-6 bg-gradient-to-r from-primary to-purple-600 hover:opacity-90 text-white shadow-lg shadow-primary/25 transition-all hover:scale-[1.01] active:scale-[0.98] flex items-center justify-center gap-2 border-0"
                    onSubmit={(formData) => {
                      if (onSubmitCreateConfirmation) {
                        void onSubmitCreateConfirmation(formData);
                      }
                    }}
                  />
                </div>

                <div className="flex items-center justify-between px-8 py-5 bg-slate-50/50 dark:bg-black/20 border-t border-slate-200/50 dark:border-white/5 backdrop-blur-md">
                  <div className="text-[13px] text-slate-500 dark:text-slate-400 font-medium">
                    切换项目或返回其他视图后，也可稍后处理
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 px-4 text-[13px] font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200/50 dark:hover:bg-white/10 rounded-full transition-all"
                    onClick={onCancelCreateConfirmation}
                  >
                    暂不处理
                  </Button>
                </div>
              </div>
            ) : (
              <div className="p-20 flex flex-col items-center justify-center text-center">
                <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900 border border-slate-200/50 dark:border-slate-700/50 flex items-center justify-center mb-8 shadow-inner relative group-hover:scale-105 transition-transform duration-500">
                  <div className="absolute inset-0 bg-primary/10 rounded-3xl blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <LayoutTemplate
                    className="w-12 h-12 text-slate-400 dark:text-slate-500 relative z-10"
                    strokeWidth={1}
                  />
                </div>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                  暂无待处理任务
                </h3>
                <p className="text-base text-slate-500 dark:text-slate-400 mb-10 max-w-sm leading-relaxed">
                  你可以通过对话输入框发送你的创作需求，或点击下方按钮手动发起。
                </p>
                <Button
                  onClick={onOpenCreateContentDialog}
                  className="h-12 px-8 rounded-full bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-slate-200 dark:text-slate-900 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 font-semibold text-[15px]"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  发起创建确认
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default WorkbenchCreateEntryHome;
