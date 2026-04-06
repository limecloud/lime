/**
 * 个人资料设置页面组件
 *
 * 保留现有资料读写逻辑，升级为更清晰的摘要卡 + 分区表单布局。
 */

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Edit2,
  Mail,
  Plus,
  Sparkles,
  Tag,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { cn } from "@/lib/utils";
import {
  getConfig,
  saveConfig,
  type Config,
  type UserProfile,
} from "@/lib/api/appConfig";

type EditableProfileField = "nickname" | "bio" | "email";

interface ProfileFieldMeta {
  key: EditableProfileField;
  label: string;
  description: string;
  placeholder: string;
  icon: LucideIcon;
  editable?: boolean;
  multiline?: boolean;
  hint: string;
}

const DEFAULT_USER_PROFILE: UserProfile = {
  avatar_url: "",
  nickname: "",
  bio: "",
  email: "",
  tags: [],
};

const PROFILE_FIELDS: ProfileFieldMeta[] = [
  {
    key: "nickname",
    label: "昵称",
    description: "展示在工作区与 AI 语境中的称呼。",
    placeholder: "还没有设置昵称",
    icon: User,
    editable: true,
    hint: "建议使用你最常用的称呼，便于系统在多处一致展示。",
  },
  {
    key: "bio",
    label: "个人简介",
    description: "用几句话说明你的工作背景、兴趣和当前目标。",
    placeholder: "补充你的角色、关注方向或当前项目，AI 会更快理解你。",
    icon: Edit2,
    editable: true,
    multiline: true,
    hint: "按 Enter 保存，使用 Shift + Enter 换行。",
  },
  {
    key: "email",
    label: "邮箱",
    description: "账号识别邮箱，当前页面仅展示，不支持直接修改。",
    placeholder: "尚未绑定邮箱",
    icon: Mail,
    editable: false,
    hint: "如需修改邮箱，请使用账号相关入口或后续专用流程。",
  },
];

const SUGGESTED_TAGS = [
  "编程",
  "写作",
  "设计",
  "数据分析",
  "产品经理",
  "创业者",
  "学生",
  "研究者",
];

function hasText(value?: string) {
  return Boolean(value?.trim());
}

interface ProfileFieldCardProps {
  field: EditableProfileField;
  icon: LucideIcon;
  label: string;
  description: string;
  value: string;
  placeholder: string;
  editable?: boolean;
  multiline?: boolean;
  hint: string;
  isEditing: boolean;
  editValue: string;
  onStartEdit: (field: EditableProfileField, currentValue: string) => void;
  onEditValueChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

function ProfileFieldCard({
  field,
  icon: Icon,
  label,
  description,
  value,
  placeholder,
  editable = true,
  multiline = false,
  hint,
  isEditing,
  editValue,
  onStartEdit,
  onEditValueChange,
  onSave,
  onCancel,
}: ProfileFieldCardProps) {
  return (
    <article className="rounded-[22px] border border-slate-200/80 bg-white/90 p-4 shadow-sm shadow-slate-950/5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-slate-700">
            <Icon className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-slate-900">{label}</p>
              <WorkbenchInfoTip
                ariaLabel={`${label}说明`}
                content={
                  <div className="space-y-1">
                    <p>{description}</p>
                    <p>{hint}</p>
                  </div>
                }
                tone="slate"
              />
              {!editable && (
                <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                  只读
                </span>
              )}
            </div>
          </div>
        </div>

        {editable && !isEditing && (
          <button
            type="button"
            aria-label={`编辑${label}`}
            onClick={() => onStartEdit(field, value)}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            <Edit2 className="h-3.5 w-3.5" />
            编辑
          </button>
        )}
      </div>

      <div className="mt-4">
        {isEditing ? (
          multiline ? (
            <textarea
              id={`profile-field-${field}`}
              value={editValue}
              onChange={(event) => {
                onEditValueChange(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onSave();
                } else if (event.key === "Escape") {
                  onCancel();
                }
              }}
              rows={4}
              className="min-h-[120px] w-full rounded-[18px] border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm leading-6 text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:bg-white"
              placeholder={placeholder}
              autoFocus
            />
          ) : (
            <input
              id={`profile-field-${field}`}
              type="text"
              value={editValue}
              onChange={(event) => {
                onEditValueChange(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSave();
                } else if (event.key === "Escape") {
                  onCancel();
                }
              }}
              className="w-full rounded-[18px] border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:bg-white"
              placeholder={placeholder}
              autoFocus
            />
          )
        ) : (
          <div className="rounded-[18px] border border-slate-100 bg-slate-50/80 px-4 py-3">
            <p
              className={cn(
                "text-sm leading-6",
                value ? "text-slate-700" : "text-slate-400",
              )}
            >
              {value || placeholder}
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs leading-5 text-slate-500">通过 Tips 查看说明</span>
        {isEditing && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={`取消编辑${label}`}
              onClick={onCancel}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              取消
            </button>
            <button
              type="button"
              aria-label={`保存${label}`}
              onClick={onSave}
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              保存
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

export function ProfileSettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_USER_PROFILE);
  const [loading, setLoading] = useState(true);
  const [editingField, setEditingField] =
    useState<EditableProfileField | null>(null);
  const [editValue, setEditValue] = useState("");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [newTag, setNewTag] = useState("");
  const messageTimerRef = useRef<number | null>(null);

  useEffect(() => {
    void loadConfig();
    return () => {
      if (messageTimerRef.current !== null) {
        window.clearTimeout(messageTimerRef.current);
      }
    };
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const loadedConfig = await getConfig();
      setConfig(loadedConfig);
      setProfile(loadedConfig.user_profile || DEFAULT_USER_PROFILE);
    } catch (error) {
      console.error("加载用户资料失败:", error);
    } finally {
      setLoading(false);
    }
  };

  const showMessage = (type: "success" | "error", text: string) => {
    if (messageTimerRef.current !== null) {
      window.clearTimeout(messageTimerRef.current);
    }

    setMessage({ type, text });
    messageTimerRef.current = window.setTimeout(() => {
      setMessage(null);
      messageTimerRef.current = null;
    }, 3000);
  };

  const saveProfileEntry = async <K extends keyof UserProfile>(
    key: K,
    value: UserProfile[K],
  ) => {
    if (!config) {
      showMessage("error", "资料配置尚未加载完成，暂时无法保存。");
      return;
    }

    try {
      const newProfile = {
        ...profile,
        [key]: value,
      };
      const completeProfile: UserProfile = {
        avatar_url: newProfile.avatar_url || profile.avatar_url || "",
        nickname: newProfile.nickname || profile.nickname || "",
        bio: newProfile.bio || profile.bio || "",
        email: newProfile.email || profile.email || "",
        tags: newProfile.tags || profile.tags || [],
      };
      const updatedFullConfig = {
        ...config,
        user_profile: completeProfile,
      };

      await saveConfig(updatedFullConfig);
      setConfig(updatedFullConfig);
      setProfile(completeProfile);
      showMessage("success", "资料已保存");
    } catch (error) {
      console.error("保存用户资料失败:", error);
      showMessage("error", `保存失败: ${error}`);
    }
  };

  const handleStartEdit = (
    field: EditableProfileField,
    currentValue: string = "",
  ) => {
    if (editingField === field) {
      return;
    }

    setEditingField(field);
    setEditValue(currentValue);
  };

  const handleSaveEdit = () => {
    if (!editingField) {
      return;
    }

    void saveProfileEntry(editingField, editValue);
    setEditingField(null);
    setEditValue("");
  };

  const handleCancelEdit = () => {
    setEditingField(null);
    setEditValue("");
  };

  const handleAddTag = () => {
    const trimmedTag = newTag.trim();
    if (!trimmedTag || (profile.tags || []).includes(trimmedTag)) {
      return;
    }

    void saveProfileEntry("tags", [...(profile.tags || []), trimmedTag]);
    setNewTag("");
  };

  const handleRemoveTag = (tag: string) => {
    void saveProfileEntry(
      "tags",
      (profile.tags || []).filter((item) => item !== tag),
    );
  };

  const handleUploadAvatar = async () => {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg,image/gif,image/webp";
      input.style.display = "none";

      input.onchange = async (event) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) {
          return;
        }

        const maxSize = 5 * 1024 * 1024;
        if (file.size > maxSize) {
          showMessage(
            "error",
            `文件过大 (${(file.size / 1024 / 1024).toFixed(2)}MB)，最大支持 5MB`,
          );
          return;
        }

        await file.arrayBuffer();
        showMessage("success", "头像上传功能正在完善中");
      };

      document.body.appendChild(input);
      input.click();
      document.body.removeChild(input);
    } catch (error) {
      console.error("上传头像失败:", error);
      showMessage("error", `上传失败: ${error}`);
    }
  };

  const tags = profile.tags || [];
  const completionItems = [
    hasText(profile.nickname),
    hasText(profile.bio),
    hasText(profile.email),
    tags.length > 0,
  ].filter(Boolean).length;
  const completionPercent = Math.round((completionItems / 4) * 100);
  const statusLabel =
    completionPercent >= 75
      ? "资料完整"
      : completionPercent >= 40
        ? "逐步成型"
        : "待补充";
  const statusClassName =
    completionPercent >= 75
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : completionPercent >= 40
        ? "border-sky-200 bg-sky-50 text-sky-700"
        : "border-amber-200 bg-amber-50 text-amber-700";
  const suggestedTags = SUGGESTED_TAGS.filter((tag) => !tags.includes(tag)).slice(
    0,
    6,
  );
  const quickTags = tags.slice(0, 3);
  const extraTagCount = Math.max(tags.length - quickTags.length, 0);
  const isInitialLoading = loading && !config;

  if (isInitialLoading) {
    return (
      <div className="space-y-4">
        <div className="h-[220px] animate-pulse rounded-[30px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(245,249,247,0.98)_0%,rgba(255,255,255,0.98)_52%,rgba(243,247,255,0.96)_100%)]" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.95fr)]">
          <div className="space-y-4">
            <div className="h-[320px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
          </div>
          <div className="space-y-4">
            <div className="h-[300px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
            <div className="h-[180px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8">
      {message && (
        <div
          className={cn(
            "flex items-center gap-3 rounded-[20px] border px-4 py-3 text-sm shadow-sm shadow-slate-950/5",
            message.type === "success"
              ? "border-emerald-200 bg-emerald-50/90 text-emerald-700"
              : "border-rose-200 bg-rose-50/90 text-rose-700",
          )}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      <section className="relative overflow-hidden rounded-[30px] border border-emerald-200/70 bg-[linear-gradient(135deg,rgba(245,250,248,0.98)_0%,rgba(255,255,255,0.98)_52%,rgba(242,247,255,0.96)_100%)] shadow-sm shadow-slate-950/5">
        <div className="pointer-events-none absolute -left-16 top-[-68px] h-52 w-52 rounded-full bg-emerald-200/25 blur-3xl" />
        <div className="pointer-events-none absolute right-[-88px] top-[-14px] h-56 w-56 rounded-full bg-sky-200/25 blur-3xl" />

        <div className="relative flex flex-col gap-6 p-6 lg:p-7">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-4">
              <div className="relative flex-shrink-0">
                <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-[28px] border border-white/90 bg-[linear-gradient(145deg,rgba(255,255,255,0.95)_0%,rgba(230,244,238,0.92)_100%)] shadow-sm shadow-slate-950/5">
                  {profile.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt="头像"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <User className="h-11 w-11 text-slate-400" />
                  )}
                </div>
                <button
                  type="button"
                  aria-label="更新头像"
                  onClick={handleUploadAvatar}
                  className="absolute -bottom-2 -right-2 flex h-10 w-10 items-center justify-center rounded-2xl border border-white bg-slate-900 text-white shadow-lg shadow-slate-950/15 transition hover:bg-slate-800"
                >
                  <Camera className="h-4 w-4" />
                </button>
              </div>

              <div className="min-w-0 space-y-3">
                <span className="inline-flex items-center rounded-full border border-white/90 bg-white/85 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-emerald-700 shadow-sm">
                  PROFILE SNAPSHOT
                </span>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                      {profile.nickname || "未设置昵称"}
                    </h2>
                    <span
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium",
                        statusClassName,
                      )}
                    >
                      {statusLabel}
                    </span>
                  </div>
                <p className="max-w-2xl text-sm leading-6 text-slate-600">
                  {profile.bio ||
                    "补充几句你的工作背景、关注方向或使用目标，AI 会更快进入正确语境。"}
                </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/90 bg-white/85 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                    <Mail className="h-3.5 w-3.5 text-slate-400" />
                    {profile.email || "邮箱待补充"}
                  </span>

                  {quickTags.length > 0 ? (
                    quickTags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-white/90 bg-white/85 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm"
                      >
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="rounded-full border border-dashed border-slate-300 bg-white/70 px-3 py-1.5 text-xs text-slate-500">
                      添加标签帮助 AI 理解你的领域偏好
                    </span>
                  )}

                  {extraTagCount > 0 && (
                    <span className="rounded-full border border-white/90 bg-white/85 px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm">
                      +{extraTagCount} 个标签
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs leading-5 text-slate-500">
                  <span>头像格式限制已收纳</span>
                  <WorkbenchInfoTip
                    ariaLabel="头像上传限制说明"
                    content="头像支持 PNG / JPG / GIF / WEBP，单文件不超过 5MB。"
                    tone="slate"
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[360px]">
              <div className="rounded-[22px] border border-white/90 bg-white/88 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <span>资料完成度</span>
                  <WorkbenchInfoTip
                    ariaLabel="资料完成度说明"
                    content="昵称、简介、邮箱与偏好标签。"
                    tone="slate"
                  />
                </div>
                <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">
                  {completionPercent}%
                </p>
              </div>
              <div className="rounded-[22px] border border-white/90 bg-white/88 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <span>兴趣标签</span>
                  <WorkbenchInfoTip
                    ariaLabel="兴趣标签说明"
                    content="用于偏好理解与内容召回。"
                    tone="slate"
                  />
                </div>
                <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">
                  {tags.length}
                </p>
              </div>
              <div className="rounded-[22px] border border-white/90 bg-white/88 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <span>个性化状态</span>
                  <WorkbenchInfoTip
                    ariaLabel="个性化状态说明"
                    content="当前资料可用于 AI 上下文提示。"
                    tone="slate"
                  />
                </div>
                <p className="mt-4 text-xl font-semibold tracking-tight text-slate-900">
                  {statusLabel}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.95fr)]">
        <div className="space-y-4">
          <article className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    基础资料
                  </p>
                  <WorkbenchInfoTip
                    ariaLabel="基础资料说明"
                    content="这些信息会参与欢迎语、工作区称呼和部分个性化提示生成。"
                    tone="slate"
                  />
                </div>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                {PROFILE_FIELDS.length} 项
              </span>
            </div>

            <div className="mt-5 space-y-4">
              {PROFILE_FIELDS.map((field) => (
                <ProfileFieldCard
                  key={field.key}
                  field={field.key}
                  icon={field.icon}
                  label={field.label}
                  description={field.description}
                  value={profile[field.key] || ""}
                  placeholder={field.placeholder}
                  editable={field.editable}
                  multiline={field.multiline}
                  hint={field.hint}
                  isEditing={editingField === field.key}
                  editValue={editValue}
                  onStartEdit={handleStartEdit}
                  onEditValueChange={setEditValue}
                  onSave={handleSaveEdit}
                  onCancel={handleCancelEdit}
                />
              ))}
            </div>
          </article>
        </div>

        <div className="space-y-4">
          <article className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Tag className="h-4 w-4 text-emerald-600" />
                  偏好标签
                  <WorkbenchInfoTip
                    ariaLabel="偏好标签说明"
                    content="标签帮助 AI 判断你更关注的主题和表达风格。"
                    tone="slate"
                  />
                </div>
              </div>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                {tags.length} 个已选
              </span>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {tags.length > 0 ? (
                tags.map((tag) => (
                  <div
                    key={tag}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700"
                  >
                    <span>{tag}</span>
                    <button
                      type="button"
                      aria-label={`移除标签${tag}`}
                      onClick={() => handleRemoveTag(tag)}
                      className="rounded-full p-0.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))
              ) : (
                <div className="rounded-[20px] border border-dashed border-slate-300 bg-slate-50/60 px-4 py-3 text-sm leading-6 text-slate-500">
                  还没有添加标签。可以从推荐标签开始，也可以输入自定义领域。
                </div>
              )}
            </div>

            <div className="mt-5 rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
              <label
                htmlFor="profile-new-tag"
                className="text-xs font-medium tracking-[0.12em] text-slate-500"
              >
                CUSTOM TAG
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="profile-new-tag"
                  type="text"
                  value={newTag}
                  onChange={(event) => setNewTag(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleAddTag();
                    }
                  }}
                  placeholder="例如：全栈工程、内容策略、效率工具"
                  className="flex-1 rounded-[16px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-slate-300"
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="inline-flex items-center gap-2 rounded-[16px] bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
                >
                  <Plus className="h-4 w-4" />
                  添加标签
                </button>
              </div>
            </div>

            <div className="mt-5">
              <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
                推荐标签
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestedTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => {
                      void saveProfileEntry("tags", [...tags, tag]);
                    }}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                  >
                    + {tag}
                  </button>
                ))}
              </div>
            </div>
          </article>

          <article className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Sparkles className="h-4 w-4 text-sky-600" />
              资料如何被使用
              <WorkbenchInfoTip
                ariaLabel="资料如何被使用说明"
                content={
                  <div className="space-y-1">
                    <p>昵称和简介会帮助 AI 在开场、建议和工作区提示中更自然地引用你的背景。</p>
                    <p>标签只用于偏好判断，不会替代系统提示词，也不会自动暴露给外部服务。</p>
                    <p>邮箱由账号体系维护，当前页面仅做展示，避免在多入口出现不一致状态。</p>
                  </div>
                }
                tone="slate"
              />
            </div>
            <div className="mt-4 rounded-[22px] border border-slate-100 bg-slate-50/70 px-4 py-3 text-xs leading-5 text-slate-500">
              说明已收纳到标题旁 Tips。
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
