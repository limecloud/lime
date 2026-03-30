/**
 * 内容编辑页面
 *
 * 集成 TipTap 编辑器和记忆侧边栏
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  ArrowLeft,
  Save,
  RefreshCw,
  PanelRightClose,
  PanelRight,
  Check,
  FileText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  ContentListItem,
  ContentDetail,
  Project,
  getContent,
  updateContent,
  formatRelativeTime,
} from "@/lib/api/project";
import { EditorToolbar } from "./editor/EditorToolbar";
import { MemorySidebar } from "./MemorySidebar";
import { toast } from "sonner";

interface ContentEditorPageProps {
  project: Project;
  content: ContentListItem;
  onBack: () => void;
}

type SaveStatus = "saved" | "saving" | "unsaved";

export function ContentEditorPage({
  project,
  content,
  onBack,
}: ContentEditorPageProps) {
  const [contentDetail, setContentDetail] = useState<ContentDetail | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState(content.title);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [showSidebar, setShowSidebar] = useState(true);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // TipTap 编辑器
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Placeholder.configure({
        placeholder: "开始写作...",
        emptyEditorClass: "is-editor-empty",
      }),
    ],
    content: "",
    onUpdate: () => {
      setSaveStatus("unsaved");
      scheduleAutoSave();
    },
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm sm:prose-base max-w-none focus:outline-none min-h-[calc(100vh-200px)]",
          "prose-headings:font-bold prose-headings:text-foreground",
          "prose-p:text-foreground prose-p:leading-relaxed",
          "prose-strong:text-foreground prose-strong:font-semibold",
          "prose-em:text-foreground",
          "prose-ul:text-foreground prose-ol:text-foreground",
          "prose-li:text-foreground",
          "prose-blockquote:text-muted-foreground prose-blockquote:border-l-primary",
          "prose-code:text-foreground prose-code:bg-muted prose-code:px-1 prose-code:rounded",
          "prose-pre:bg-muted prose-pre:text-foreground",
        ),
      },
    },
  });

  // 加载内容详情
  const loadContent = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await getContent(content.id);
      if (detail) {
        setContentDetail(detail);
        setTitle(detail.title);
        editor?.commands.setContent(detail.body || "");
      }
    } catch (error) {
      console.error("加载内容失败:", error);
      toast.error("加载内容失败");
    } finally {
      setLoading(false);
    }
  }, [content.id, editor]);

  useEffect(() => {
    loadContent();
  }, [loadContent]);

  // 保存内容的 ref（用于避免循环依赖）
  const handleSaveRef = useRef<() => Promise<void>>();

  // 自动保存调度
  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      handleSaveRef.current?.();
    }, 3000);
  }, []);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  // 保存内容
  const handleSave = async () => {
    if (!editor || saveStatus === "saving") return;

    setSaveStatus("saving");
    try {
      const body = editor.getHTML();
      await updateContent(content.id, {
        title,
        body,
      });
      setSaveStatus("saved");
    } catch (error) {
      console.error("保存失败:", error);
      toast.error("保存失败");
      setSaveStatus("unsaved");
    }
  };

  // 更新 ref
  handleSaveRef.current = handleSave;

  // 标题变化时标记为未保存
  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    setSaveStatus("unsaved");
    scheduleAutoSave();
  };

  // 手动保存
  const handleManualSave = () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    handleSave();
  };

  // 返回时检查是否有未保存的更改
  const handleBack = () => {
    if (saveStatus === "unsaved") {
      if (confirm("有未保存的更改，确定要离开吗？")) {
        onBack();
      }
    } else {
      onBack();
    }
  };
  const wordCount = editor?.storage.characterCount?.characters?.() || 0;
  const saveStateLabel =
    saveStatus === "saving"
      ? "保存中"
      : saveStatus === "saved"
        ? "已同步"
        : "待保存";
  const topBadges = [
    project.name,
    saveStateLabel,
    showSidebar ? "记忆侧栏已打开" : "记忆侧栏已隐藏",
  ];
  const summaryCards = [
    {
      label: "当前字数",
      value: String(wordCount),
      description: "正文实时统计，便于控制章节体量",
    },
    {
      label: "最后更新",
      value: formatRelativeTime(contentDetail?.updated_at || 0),
      description: "最近一次同步到项目内容的时间",
    },
    {
      label: "侧栏状态",
      value: showSidebar ? "已展开" : "已收起",
      description: "角色与世界观可在右侧快速查看",
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(248,250,252,0.96)_0%,rgba(255,255,255,0.98)_18%,rgba(241,245,249,0.95)_100%)]">
      <div className="mx-auto flex w-full max-w-[1680px] flex-1 flex-col gap-5 px-4 pb-4 pt-4 lg:px-6">
        <section className="relative overflow-hidden rounded-[30px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(247,250,252,0.98)_0%,rgba(255,255,255,0.98)_46%,rgba(240,249,255,0.95)_100%)] shadow-sm shadow-slate-950/5">
          <div className="pointer-events-none absolute -left-16 top-[-54px] h-48 w-48 rounded-full bg-sky-200/25 blur-3xl" />
          <div className="pointer-events-none absolute right-[-54px] top-[-22px] h-48 w-48 rounded-full bg-emerald-200/20 blur-3xl" />
          <div className="relative flex flex-col gap-6 p-5 lg:p-6">
            <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-4xl space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleBack}
                    className="rounded-full border-white/90 bg-white/85 px-3 shadow-sm shadow-slate-950/5"
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    返回内容列表
                  </Button>
                  <Badge className="border-0 bg-slate-900/90 text-white hover:bg-slate-900/90">
                    当前稿件
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-slate-200/80 bg-white/80 text-slate-600"
                  >
                    {content.content_type}
                  </Badge>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-[18px] border border-white/90 bg-white/88 text-slate-700 shadow-sm shadow-slate-950/5">
                      <FileText className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1 rounded-[24px] border border-white/90 bg-white/88 px-4 py-3 shadow-sm shadow-slate-950/5">
                      <div className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                        Draft
                      </div>
                      <Input
                        value={title}
                        onChange={(e) => handleTitleChange(e.target.value)}
                        className="h-auto border-none bg-transparent px-0 text-2xl font-semibold tracking-tight text-slate-900 shadow-none focus-visible:ring-0"
                        placeholder="输入标题..."
                      />
                    </div>
                  </div>
                  <p className="max-w-3xl text-sm leading-6 text-slate-600">
                    在统一的编辑工作台里继续写作，并随时查看右侧记忆侧栏中的角色与世界观。
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {topBadges.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-white/90 bg-white/85 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-4 xl:min-w-[440px] xl:items-end">
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <div className="flex items-center gap-2 rounded-full border border-white/90 bg-white/85 px-3 py-2 text-sm text-slate-600 shadow-sm shadow-slate-950/5">
                    {saveStatus === "saving" ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : saveStatus === "saved" ? (
                      <Check className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <Save className="h-4 w-4 text-amber-600" />
                    )}
                    <span>{saveStateLabel}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleManualSave}
                    disabled={saveStatus === "saving" || saveStatus === "saved"}
                    className="border-white/90 bg-white/85 shadow-sm shadow-slate-950/5"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    保存稿件
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowSidebar(!showSidebar)}
                    title={showSidebar ? "隐藏侧边栏" : "显示侧边栏"}
                    className="rounded-full border border-white/90 bg-white/80 text-slate-600 shadow-sm shadow-slate-950/5 hover:bg-white"
                  >
                    {showSidebar ? (
                      <PanelRightClose className="h-5 w-5" />
                    ) : (
                      <PanelRight className="h-5 w-5" />
                    )}
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 xl:w-full">
                  {summaryCards.map((item) => (
                    <div
                      key={item.label}
                      className="rounded-[22px] border border-white/90 bg-white/88 p-4 shadow-sm shadow-slate-950/5"
                    >
                      <div className="text-sm font-semibold text-slate-800">
                        {item.label}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate-500">
                        {item.description}
                      </div>
                      <div className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[32px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.94)_0%,rgba(255,255,255,0.98)_20%,rgba(248,250,252,0.96)_100%)] shadow-sm shadow-slate-950/5">
              <EditorToolbar editor={editor} />

              <div className="flex-1 overflow-auto px-4 pb-4 lg:px-5">
                <div
                  className={cn(
                    "mx-auto max-w-5xl pt-4 xl:max-w-6xl",
                    "[&_.is-editor-empty:first-child::before]:text-muted-foreground",
                    "[&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
                    "[&_.is-editor-empty:first-child::before]:float-left",
                    "[&_.is-editor-empty:first-child::before]:h-0",
                    "[&_.is-editor-empty:first-child::before]:pointer-events-none",
                  )}
                >
                  <div className="min-h-[calc(100vh-360px)] rounded-[30px] border border-white/90 bg-white px-6 py-7 shadow-sm shadow-slate-950/5 lg:px-10 lg:py-10">
                    <EditorContent editor={editor} />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200/80 px-5 py-3 text-xs text-slate-500">
                <span>字数: {wordCount}</span>
                <span>最后更新: {formatRelativeTime(contentDetail?.updated_at || 0)}</span>
              </div>
            </section>
          </div>

          {showSidebar && (
            <MemorySidebar
              projectId={project.id}
              className="w-[320px] xl:w-[360px]"
            />
          )}
        </div>
      </div>
    </div>
  );
}
