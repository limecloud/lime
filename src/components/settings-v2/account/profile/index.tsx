/**
 * 个人资料设置页面组件
 *
 * 参考成熟产品的资料实现
 * 功能包括：用户头像、昵称、个人简介、偏好标签等
 */

import { useState, useEffect } from "react";
import {
  User,
  Mail,
  Edit2,
  Camera,
  Info,
  CheckCircle2,
  AlertCircle,
  Tag,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getConfig, saveConfig, type Config } from "@/lib/api/appConfig";

interface UserProfile {
  /** 用户头像 URL */
  avatar_url?: string;
  /** 昵称 */
  nickname?: string;
  /** 个人简介 */
  bio?: string;
  /** 邮箱 */
  email?: string;
  /** 偏好标签 */
  tags?: string[];
}

const DEFAULT_USER_PROFILE: UserProfile = {
  avatar_url: "",
  nickname: "",
  bio: "",
  email: "",
  tags: [],
};

// 标签到字段名的映射
const LABEL_TO_FIELD_MAP: Record<string, keyof UserProfile> = {
  昵称: "nickname",
  简介: "bio",
  邮箱: "email",
};

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

export function ProfileSettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_USER_PROFILE);
  const [_loading, setLoading] = useState(true);
  const [editingField, setEditingField] = useState<keyof UserProfile | null>(
    null,
  );
  const [editValue, setEditValue] = useState("");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [newTag, setNewTag] = useState("");

  // 加载配置
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const c = await getConfig();
      setConfig(c);
      setProfile(c.user_profile || DEFAULT_USER_PROFILE);
    } catch (e) {
      console.error("加载用户资料失败:", e);
    } finally {
      setLoading(false);
    }
  };

  // 保存配置
  const saveProfile = async (key: keyof UserProfile, value: any) => {
    if (!config) return;

    try {
      const newProfile = {
        ...profile,
        [key]: value,
      };
      // 确保其他字段也存在
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

      showMessage("success", "保存成功");
    } catch (e) {
      console.error("保存用户资料失败:", e);
      showMessage("error", `保存失败: ${e}`);
    }
  };

  // 开始编辑
  const handleStartEdit = (
    fieldOrLabel: keyof UserProfile | string,
    currentValue: string = "",
  ) => {
    // 如果是标签，转换为字段名
    const field =
      typeof fieldOrLabel === "string"
        ? LABEL_TO_FIELD_MAP[fieldOrLabel] ||
          (fieldOrLabel as keyof UserProfile)
        : fieldOrLabel;

    // 如果正在编辑同一个字段，不做任何操作
    if (editingField === field) {
      return;
    }

    // 如果正在编辑不同的字段，先取消当前编辑（不保存）
    if (editingField && editingField !== field) {
      setEditValue("");
    }

    setEditingField(field);
    setEditValue(currentValue);
  };

  // 保存编辑
  const handleSaveEdit = () => {
    if (editingField) {
      saveProfile(editingField, editValue);
      setEditingField(null);
      setEditValue("");
    }
  };

  // 取消编辑
  const handleCancelEdit = () => {
    setEditingField(null);
    setEditValue("");
  };

  // 添加标签
  const handleAddTag = () => {
    if (newTag && !(profile.tags || []).includes(newTag)) {
      saveProfile("tags", [...(profile.tags || []), newTag]);
      setNewTag("");
    }
  };

  // 删除标签
  const handleRemoveTag = (tag: string) => {
    saveProfile(
      "tags",
      (profile.tags || []).filter((t) => t !== tag),
    );
  };

  // 上传头像
  const handleUploadAvatar = async () => {
    try {
      // 创建文件选择输入
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg,image/gif,image/webp";
      input.style.display = "none";

      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        // 验证文件大小（5MB）
        const maxSize = 5 * 1024 * 1024;
        if (file.size > maxSize) {
          showMessage(
            "error",
            `文件过大 (${(file.size / 1024 / 1024).toFixed(2)}MB)，最大支持 5MB`,
          );
          return;
        }

        // 读取文件为 ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();
        const _uint8Array = new Uint8Array(arrayBuffer);

        // 调用 Tauri API 上传文件
        // 注意：这需要后端支持从 bytes 保存文件，目前简化处理
        showMessage("success", "头像上传功能正在完善中");
      };

      document.body.appendChild(input);
      input.click();
      document.body.removeChild(input);
    } catch (e) {
      console.error("上传头像失败:", e);
      showMessage("error", `上传失败: ${e}`);
    }
  };

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const ProfileRow = ({
    icon: Icon,
    label,
    value,
    editable = true,
    multiline = false,
  }: {
    icon: any;
    label: string;
    value: string;
    editable?: boolean;
    multiline?: boolean;
  }) => {
    // 获取对应的字段名
    const field = LABEL_TO_FIELD_MAP[label] || (label as keyof UserProfile);

    return (
      <div className="flex items-center justify-between px-4 py-3 border-b last:border-b-0">
        <div className="flex items-center gap-3 min-w-0">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-2 flex-1 justify-end min-w-0 pl-4">
          {editingField === field ? (
            multiline ? (
              <textarea
                value={editValue}
                onChange={(e) => {
                  setEditValue(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSaveEdit();
                  } else if (e.key === "Escape") {
                    handleCancelEdit();
                  }
                }}
                rows={3}
                className="flex-1 max-w-xs px-3 py-2 rounded border bg-background text-sm focus:ring-1 focus:ring-primary/20 focus:border-primary outline-none resize-none"
                autoFocus
              />
            ) : (
              <input
                type="text"
                value={editValue}
                onChange={(e) => {
                  setEditValue(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSaveEdit();
                  } else if (e.key === "Escape") {
                    handleCancelEdit();
                  }
                }}
                className="flex-1 max-w-xs px-3 py-1.5 rounded border bg-background text-sm focus:ring-1 focus:ring-primary/20 focus:border-primary outline-none"
                autoFocus
              />
            )
          ) : (
            <span className="text-sm text-muted-foreground truncate max-w-[420px] text-right">
              {value || "未设置"}
            </span>
          )}
          {editable && !editingField && (
            <button
              onClick={() => handleStartEdit(label, value)}
              className="p-1.5 rounded hover:bg-muted transition-colors flex-shrink-0"
            >
              <Edit2 className="h-3.5 w-3.5" />
            </button>
          )}
          {editingField === field && (
            <div className="flex gap-1 flex-shrink-0">
              <button
                onClick={handleSaveEdit}
                className="p-1.5 rounded hover:bg-green-100 text-green-600 transition-colors"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleCancelEdit}
                className="p-1.5 rounded hover:bg-red-100 text-red-600 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4 w-full">
      {/* 头像和基本信息 */}
      <div className="rounded-lg border p-4">
        <div className="flex items-center gap-4">
          {/* 头像 */}
          <div className="relative group">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center overflow-hidden">
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt="头像"
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="h-10 w-10 text-primary/50" />
              )}
            </div>
            <button
              onClick={handleUploadAvatar}
              className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Camera className="h-6 w-6 text-white" />
            </button>
          </div>

          {/* 昵称和简介 */}
          <div className="flex-1">
            <h3 className="text-lg font-semibold">
              {profile.nickname || "未设置昵称"}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {profile.bio || "未设置个人简介"}
            </p>
            {profile.email && (
              <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                <Mail className="h-3 w-3" />
                {profile.email}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 详细信息编辑 */}
      <div className="rounded-lg border overflow-hidden">
        <ProfileRow icon={User} label="昵称" value={profile.nickname || ""} />
        <ProfileRow
          icon={Edit2}
          label="简介"
          value={profile.bio || ""}
          multiline
        />
        <ProfileRow
          icon={Mail}
          label="邮箱"
          value={profile.email || ""}
          editable={false}
        />
      </div>

      {/* 偏好标签 */}
      <div className="rounded-lg border p-4">
        <div className="flex items-center gap-2 mb-3">
          <Tag className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">偏好标签</h3>
        </div>

        {/* 已选择的标签 */}
        <div className="flex flex-wrap gap-2 mb-3">
          {(profile.tags || []).map((tag) => (
            <div
              key={tag}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm"
            >
              {tag}
              <button
                onClick={() => handleRemoveTag(tag)}
                className="hover:bg-primary/20 rounded-full p-0.5 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {!(profile.tags || []).length && (
            <p className="text-sm text-muted-foreground">
              还没有添加标签，选择一些您感兴趣的领域
            </p>
          )}
        </div>

        {/* 添加新标签 */}
        <div className="flex gap-2">
          <input
            type="text"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddTag();
              }
            }}
            placeholder="输入自定义标签"
            className="flex-1 px-3 py-2 rounded-lg border bg-background text-sm focus:ring-1 focus:ring-primary/20 focus:border-primary outline-none"
          />
          <button
            onClick={handleAddTag}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90"
          >
            添加
          </button>
        </div>

        {/* 推荐标签 */}
        <div className="mt-3">
          <p className="text-xs text-muted-foreground mb-2">推荐标签：</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_TAGS.filter((tag) => !(profile.tags || []).includes(tag))
              .slice(0, 6)
              .map((tag) => (
                <button
                  key={tag}
                  onClick={() => {
                    const newTags = [...(profile.tags || []), tag];
                    saveProfile("tags", newTags);
                  }}
                  className="px-3 py-1.5 rounded-full border text-sm hover:bg-muted transition-colors"
                >
                  + {tag}
                </button>
              ))}
          </div>
        </div>
      </div>

      {/* 提示信息 */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground p-3 bg-muted/30 rounded-lg">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
        <p>
          您的个人资料用于个性化 AI 助理的回复。这些信息会帮助 AI
          更好地理解您的需求和偏好。您随时可以修改这些信息。
        </p>
      </div>

      {/* 消息提示 */}
      {message && (
        <div
          className={cn(
            "flex items-center gap-2 p-3 rounded-lg",
            message.type === "success"
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
          )}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          <span className="text-sm">{message.text}</span>
        </div>
      )}
    </div>
  );
}

export default ProfileSettings;
