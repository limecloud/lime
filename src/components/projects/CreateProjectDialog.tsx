/**
 * 创建项目对话框
 *
 * 用于创建新项目
 */

import { useState, useEffect, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  ProjectType,
  USER_PROJECT_TYPES,
  extractErrorMessage,
  getCreateProjectErrorMessage,
  getProjectTypeLabel,
  getProjectTypeIcon,
  getProjectByRootPath,
  getWorkspaceProjectsRoot,
  resolveProjectRootPath,
} from "@/lib/api/project";
import { toast } from "sonner";

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string, type: ProjectType) => Promise<void>;
  defaultType?: ProjectType;
  defaultName?: string;
  allowedTypes?: ProjectType[];
}

export function CreateProjectDialog({
  open,
  onOpenChange,
  onSubmit,
  defaultType,
  defaultName,
  allowedTypes,
}: CreateProjectDialogProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ProjectType>(defaultType || "general");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [workspaceRootPath, setWorkspaceRootPath] = useState("");
  const [resolvedProjectPath, setResolvedProjectPath] = useState("");
  const [pathChecking, setPathChecking] = useState(false);
  const [pathConflictMessage, setPathConflictMessage] = useState("");

  const visibleTypes = useMemo(() => {
    const candidates =
      allowedTypes && allowedTypes.length > 0
        ? allowedTypes
        : USER_PROJECT_TYPES;

    return candidates.filter((candidate): candidate is ProjectType =>
      USER_PROJECT_TYPES.includes(
        candidate as (typeof USER_PROJECT_TYPES)[number],
      ),
    );
  }, [allowedTypes]);

  const fallbackType = visibleTypes[0] || "general";

  // 当对话框打开且 defaultType 变化时，更新类型选择
  useEffect(() => {
    if (!open) {
      return;
    }

    if (defaultType && visibleTypes.includes(defaultType)) {
      setType(defaultType);
      return;
    }

    if (!visibleTypes.includes(type)) {
      setType(fallbackType);
    }
  }, [defaultType, fallbackType, open, type, visibleTypes]);

  // 当对话框打开且 defaultName 变化时，更新项目名称
  useEffect(() => {
    if (open && defaultName) {
      setName(defaultName);
    }
  }, [open, defaultName]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let mounted = true;

    const loadWorkspaceRoot = async () => {
      try {
        const root = await getWorkspaceProjectsRoot();
        if (mounted) {
          setWorkspaceRootPath(root);
        }
      } catch (error) {
        console.error("加载 workspace 目录失败:", error);
        if (mounted) {
          setWorkspaceRootPath("");
        }
      }
    };

    void loadWorkspaceRoot();

    return () => {
      mounted = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const projectName = name.trim();
    if (!projectName) {
      setResolvedProjectPath("");
      setPathChecking(false);
      setPathConflictMessage("");
      return;
    }

    let mounted = true;

    const resolvePath = async () => {
      try {
        const path = await resolveProjectRootPath(projectName);
        if (mounted) {
          setResolvedProjectPath(path);
          setPathConflictMessage("");
        }
      } catch (error) {
        console.error("解析项目目录失败:", error);
        if (mounted) {
          setResolvedProjectPath("");
          setPathConflictMessage("");
        }
      }
    };

    void resolvePath();

    return () => {
      mounted = false;
    };
  }, [open, name]);

  useEffect(() => {
    if (!open || !resolvedProjectPath) {
      setPathChecking(false);
      setPathConflictMessage("");
      return;
    }

    let mounted = true;
    setPathChecking(true);

    const checkPathConflict = async () => {
      try {
        const existingProject = await getProjectByRootPath(resolvedProjectPath);
        if (!mounted) {
          return;
        }

        if (existingProject) {
          setPathConflictMessage(`路径已存在项目：${existingProject.name}`);
        } else {
          setPathConflictMessage("");
        }
      } catch (error) {
        console.error("检查项目路径冲突失败:", error);
        if (mounted) {
          setPathConflictMessage("");
        }
      } finally {
        if (mounted) {
          setPathChecking(false);
        }
      }
    };

    void checkPathConflict();

    return () => {
      mounted = false;
    };
  }, [open, resolvedProjectPath]);

  const handleSubmit = async () => {
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      await onSubmit(name.trim(), type);
      setName("");
      setType(
        defaultType && visibleTypes.includes(defaultType)
          ? defaultType
          : fallbackType,
      );
      onOpenChange(false);
    } catch (error) {
      console.error("创建项目失败:", error);
      const message = extractErrorMessage(error);
      const friendlyMessage = getCreateProjectErrorMessage(message);
      toast.error(`创建项目失败: ${friendlyMessage}`);
    } finally {
      setIsSubmitting(false);
    }
  };
  const topBadges = [
    getProjectTypeLabel(type),
    workspaceRootPath ? "工作区目录已解析" : "等待目录加载",
    pathConflictMessage ? "路径冲突" : "路径可用",
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] overflow-hidden border-slate-200/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.98)_0%,rgba(255,255,255,0.98)_38%,rgba(240,249,255,0.94)_100%)] p-0">
        <DialogHeader className="border-b border-white/80 px-6 py-5">
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>
            创建一个新的内容创作项目，目录将固定在 workspace 目录下。
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[78vh] gap-5 overflow-auto p-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-5">
            <section className="relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(247,250,252,0.98)_0%,rgba(255,255,255,0.98)_48%,rgba(240,249,255,0.94)_100%)] p-5 shadow-sm shadow-slate-950/5">
              <div className="pointer-events-none absolute -left-10 top-[-28px] h-24 w-24 rounded-full bg-sky-200/20 blur-3xl" />
              <div className="pointer-events-none absolute right-[-14px] top-0 h-20 w-20 rounded-full bg-emerald-200/20 blur-3xl" />
              <div className="relative space-y-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    创建新的项目工作台
                  </div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">
                    先确定项目名称和类型，再确认目录路径，后续内容、风格和记忆都会挂到这个项目下。
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {topBadges.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-white/90 bg-white/85 px-3 py-1 text-[11px] font-medium text-slate-600 shadow-sm"
                    >
                      {item}
                    </span>
                  ))}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="name">项目名称</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="输入项目名称..."
                    autoFocus
                    className="h-11 border-slate-200/80 bg-white/90"
                  />
                </div>
              </div>
            </section>

            <section className="rounded-[28px] border border-slate-200/80 bg-white/92 p-5 shadow-sm shadow-slate-950/5">
              <div className="mb-4">
                <div className="text-sm font-semibold text-slate-900">
                  选择项目类型
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-500">
                  类型会影响后续默认内容、工作台结构和推荐视图。
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {visibleTypes.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={cn(
                      "flex min-h-[112px] flex-col items-center justify-center gap-2 rounded-[22px] border px-4 py-4 text-center transition",
                      type === t
                        ? "border-emerald-200 bg-[linear-gradient(135deg,rgba(240,253,250,0.98)_0%,rgba(236,253,245,0.96)_52%,rgba(224,242,254,0.95)_100%)] shadow-sm shadow-emerald-950/10"
                        : "border-slate-200/80 bg-slate-50/70 hover:border-slate-300 hover:bg-white",
                    )}
                    onClick={() => setType(t)}
                  >
                    <span className="text-2xl">{getProjectTypeIcon(t)}</span>
                    <span className="text-xs font-medium text-slate-900">
                      {getProjectTypeLabel(t)}
                    </span>
                    {type === t ? (
                      <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700">
                        当前选择
                      </Badge>
                    ) : null}
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className="space-y-5">
            <section className="rounded-[28px] border border-slate-200/80 bg-white/92 p-5 shadow-sm shadow-slate-950/5">
              <div className="mb-4">
                <div className="text-sm font-semibold text-slate-900">
                  目录与路径
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-500">
                  项目会固定创建在 workspace 根目录下，避免目录来源不一致。
                </div>
              </div>

              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="workspace-root">workspace 目录</Label>
                  <Input
                    id="workspace-root"
                    value={workspaceRootPath}
                    placeholder="加载中..."
                    readOnly
                    className="bg-slate-50/80"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="project-path-preview">项目路径预览</Label>
                  <Input
                    id="project-path-preview"
                    value={resolvedProjectPath}
                    placeholder="请输入项目名称"
                    readOnly
                    className="bg-slate-50/80"
                  />
                  <p className="break-all text-xs leading-5 text-slate-500">
                    将创建到：{resolvedProjectPath || "请输入项目名称"}
                  </p>
                  {pathChecking && (
                    <p className="text-xs text-slate-500">正在检查路径...</p>
                  )}
                  {!pathChecking && pathConflictMessage && (
                    <p className="text-xs text-destructive">
                      {pathConflictMessage}
                    </p>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.9)_0%,rgba(255,255,255,0.98)_100%)] p-5 shadow-sm shadow-slate-950/5">
              <div className="text-sm font-semibold text-slate-900">
                创建建议
              </div>
              <div className="mt-2 space-y-2 text-xs leading-5 text-slate-500">
                <p>项目名称尽量稳定，后续会同步影响目录名和项目识别。</p>
                <p>如果路径已冲突，优先改项目名，不要手工改系统目录。</p>
                <p>项目类型决定默认工作台结构，先选最贴近当前任务的类型。</p>
              </div>
            </section>
          </div>
        </div>
        <DialogFooter className="border-t border-white/80 px-6 py-4">
          <Button
            variant="outline"
            className="border-slate-200/80 bg-white"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              !name.trim() ||
              isSubmitting ||
              pathChecking ||
              !!pathConflictMessage
            }
          >
            {isSubmitting ? "创建中..." : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
