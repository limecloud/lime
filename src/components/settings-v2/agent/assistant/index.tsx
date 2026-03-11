/**
 * 助理服务配置设置组件
 *
 * 参考成熟产品的助理能力实现
 * 功能包括：默认助理选择、助理参数配置等
 */

import { useState, useEffect } from "react";
import {
  Bot,
  Settings2,
  Sparkles,
  Info,
  CheckCircle2,
  AlertCircle,
  Plus,
  Edit2,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getConfig, saveConfig, type Config } from "@/lib/api/appConfig";

interface AssistantProfile {
  id: string;
  name: string;
  description?: string;
  model?: string;
  system_prompt?: string;
  temperature?: number;
  max_tokens?: number;
}

interface AssistantConfig {
  /** 默认助理 ID */
  default_assistant_id?: string;
  /** 自定义助理列表 */
  custom_assistants?: AssistantProfile[];
  /** 启用助理自动选择 */
  auto_select?: boolean;
  /** 显示助理建议 */
  show_suggestions?: boolean;
}

const DEFAULT_ASSISTANT_CONFIG: AssistantConfig = {
  default_assistant_id: "default",
  custom_assistants: [],
  auto_select: false,
  show_suggestions: true,
};

const PRESET_ASSISTANTS: AssistantProfile[] = [
  {
    id: "default",
    name: "通用助理",
    description: "适合日常对话和通用任务",
    model: "gpt-4",
    temperature: 0.7,
  },
  {
    id: "coder",
    name: "编程助手",
    description: "专注于编程和代码相关任务",
    model: "gpt-4",
    temperature: 0.3,
  },
  {
    id: "writer",
    name: "写作助理",
    description: "帮助撰写和编辑各类文本",
    model: "gpt-4",
    temperature: 0.8,
  },
  {
    id: "analyst",
    name: "数据分析",
    description: "协助处理和分析数据",
    model: "gpt-4",
    temperature: 0.5,
  },
];

export function AssistantSettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [assistantConfig, setAssistantConfig] = useState<AssistantConfig>(
    DEFAULT_ASSISTANT_CONFIG,
  );
  const [loading, setLoading] = useState(true);
  const [_saving, setSaving] = useState<Record<string, boolean>>({});
  const [editingAssistant, setEditingAssistant] =
    useState<AssistantProfile | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // 加载配置
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const c = await getConfig();
      setConfig(c);
      setAssistantConfig(c.assistant || DEFAULT_ASSISTANT_CONFIG);
    } catch (e) {
      console.error("加载助理配置失败:", e);
    } finally {
      setLoading(false);
    }
  };

  // 保存配置
  const saveAssistantConfig = async (
    key: keyof AssistantConfig,
    value: any,
  ) => {
    if (!config) return;
    setSaving((prev) => ({ ...prev, [key]: true }));

    try {
      const newConfig = {
        ...assistantConfig,
        [key]: value,
      };
      const updatedFullConfig = {
        ...config,
        assistant: newConfig,
      };
      await saveConfig(updatedFullConfig);
      setConfig(updatedFullConfig);
      setAssistantConfig(newConfig);

      showMessage("success", "设置已保存");
    } catch (e) {
      console.error("保存助理配置失败:", e);
      showMessage("error", "保存失败");
    } finally {
      setSaving((prev) => ({ ...prev, [key]: false }));
    }
  };

  // 添加自定义助理
  const handleAddAssistant = () => {
    const newAssistant: AssistantProfile = {
      id: `custom_${Date.now()}`,
      name: "新助理",
      description: "",
      model: "gpt-4",
      temperature: 0.7,
    };
    const updatedAssistants = [
      ...(assistantConfig.custom_assistants || []),
      newAssistant,
    ];
    saveAssistantConfig("custom_assistants", updatedAssistants);
    setEditingAssistant(newAssistant);
  };

  // 编辑助理
  const handleEditAssistant = (assistant: AssistantProfile) => {
    setEditingAssistant(assistant);
  };

  // 删除助理
  const handleDeleteAssistant = (id: string) => {
    const updatedAssistants =
      assistantConfig.custom_assistants?.filter((a) => a.id !== id) || [];
    saveAssistantConfig("custom_assistants", updatedAssistants);

    // 如果删除的是默认助理，重置为系统默认
    if (assistantConfig.default_assistant_id === id) {
      saveAssistantConfig("default_assistant_id", "default");
    }
  };

  // 保存助理编辑
  const handleSaveAssistant = (updatedAssistant: AssistantProfile) => {
    const updatedAssistants =
      assistantConfig.custom_assistants?.map((a) =>
        a.id === updatedAssistant.id ? updatedAssistant : a,
      ) || [];
    saveAssistantConfig("custom_assistants", updatedAssistants);
    setEditingAssistant(null);
  };

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const allAssistants = [
    ...PRESET_ASSISTANTS,
    ...(assistantConfig.custom_assistants || []),
  ];

  return (
    <div className="space-y-4 max-w-2xl">
      {/* 默认助理选择 */}
      <div className="rounded-lg border p-3">
        <div className="flex items-center gap-2 mb-3">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-medium">默认助理</h3>
            <p className="text-xs text-muted-foreground">
              选择启动时使用的默认助理
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {allAssistants.map((assistant) => (
            <button
              key={assistant.id}
              onClick={() =>
                saveAssistantConfig("default_assistant_id", assistant.id)
              }
              className={cn(
                "px-3 py-2 rounded-lg text-sm transition-colors border text-left",
                assistantConfig.default_assistant_id === assistant.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "hover:bg-muted",
              )}
            >
              <div className="font-medium">{assistant.name}</div>
              <div className="text-xs opacity-80">{assistant.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 自定义助理管理 */}
      <div className="rounded-lg border p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <div>
              <h3 className="text-sm font-medium">自定义助理</h3>
              <p className="text-xs text-muted-foreground">
                创建和管理您的专属助理
              </p>
            </div>
          </div>
          <button
            onClick={handleAddAssistant}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            新建
          </button>
        </div>

        {assistantConfig.custom_assistants &&
        assistantConfig.custom_assistants.length > 0 ? (
          <div className="space-y-2">
            {assistantConfig.custom_assistants.map((assistant) => (
              <div
                key={assistant.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-muted/30"
              >
                <div className="flex-1">
                  <div className="text-sm font-medium">{assistant.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {assistant.description || "无描述"}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleEditAssistant(assistant)}
                    className="p-1.5 rounded hover:bg-muted transition-colors"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteAssistant(assistant.id)}
                    className="p-1.5 rounded hover:bg-destructive/10 text-destructive transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Bot className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">暂无自定义助理</p>
            <p className="text-xs">点击上方按钮创建您的第一个助理</p>
          </div>
        )}
      </div>

      {/* 其他选项 */}
      <div className="rounded-lg border p-3">
        <div className="flex items-center gap-2 mb-3">
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-medium">其他选项</h3>
            <p className="text-xs text-muted-foreground">配置助理的其他行为</p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="flex items-center justify-between py-1.5 cursor-pointer">
            <div>
              <span className="text-sm">自动选择助理</span>
              <p className="text-xs text-muted-foreground">
                根据对话内容自动推荐合适的助理
              </p>
            </div>
            <input
              type="checkbox"
              checked={assistantConfig.auto_select ?? false}
              onChange={(e) =>
                saveAssistantConfig("auto_select", e.target.checked)
              }
              disabled={loading}
              className="w-4 h-4 rounded border-gray-300"
            />
          </label>

          <label className="flex items-center justify-between py-1.5 cursor-pointer border-t">
            <div>
              <span className="text-sm">显示助理建议</span>
              <p className="text-xs text-muted-foreground">
                在对话时显示相关助理的切换建议
              </p>
            </div>
            <input
              type="checkbox"
              checked={assistantConfig.show_suggestions ?? true}
              onChange={(e) =>
                saveAssistantConfig("show_suggestions", e.target.checked)
              }
              disabled={loading}
              className="w-4 h-4 rounded border-gray-300"
            />
          </label>
        </div>
      </div>

      {/* 提示信息 */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground p-3 bg-muted/30 rounded-lg">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
        <p>
          系统助理提供了针对不同场景优化的预设配置。您也可以创建自定义助理来满足特定需求。
          自定义助理可以调整模型参数和系统提示词。
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

      {/* 编辑助理对话框（简化版） */}
      {editingAssistant && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg p-4 max-w-md w-full mx-4">
            <h3 className="text-lg font-medium mb-4">编辑助理</h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium mb-1.5 block">名称</label>
                <input
                  type="text"
                  value={editingAssistant.name}
                  onChange={(e) =>
                    setEditingAssistant({
                      ...editingAssistant,
                      name: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 rounded border bg-background text-sm focus:ring-1 focus:ring-primary/20 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">描述</label>
                <input
                  type="text"
                  value={editingAssistant.description || ""}
                  onChange={(e) =>
                    setEditingAssistant({
                      ...editingAssistant,
                      description: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 rounded border bg-background text-sm focus:ring-1 focus:ring-primary/20 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  系统提示词
                </label>
                <textarea
                  value={editingAssistant.system_prompt || ""}
                  onChange={(e) =>
                    setEditingAssistant({
                      ...editingAssistant,
                      system_prompt: e.target.value,
                    })
                  }
                  rows={3}
                  className="w-full px-3 py-2 rounded border bg-background text-sm focus:ring-1 focus:ring-primary/20 focus:border-primary outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setEditingAssistant(null)}
                  className="px-4 py-2 rounded border text-sm hover:bg-muted"
                >
                  取消
                </button>
                <button
                  onClick={() => handleSaveAssistant(editingAssistant)}
                  className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm hover:bg-primary/90"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AssistantSettings;
