import { useState } from "react";
import { Plus, Trash2, Key, Globe, Ban, Eye, EyeOff } from "lucide-react";
import type { GeminiApiKeyEntry } from "@/lib/api/providerRuntime";

interface GeminiApiKeySectionProps {
  entries: GeminiApiKeyEntry[] | undefined;
  onChange: (entries: GeminiApiKeyEntry[]) => void;
}

export function GeminiApiKeySection({
  entries = [],
  onChange,
}: GeminiApiKeySectionProps) {
  const primaryActionButtonClassName =
    "rounded-lg border border-emerald-200 bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)] text-sm text-white shadow-sm shadow-emerald-950/15 hover:opacity-95";
  // 确保 entries 是数组
  const safeEntries = Array.isArray(entries) ? entries : [];
  const [showKeys, setShowKeys] = useState<Set<string>>(new Set());
  const [editingExclusions, setEditingExclusions] = useState<string | null>(
    null,
  );
  const [exclusionInput, setExclusionInput] = useState("");

  const toggleShowKey = (id: string) => {
    const newSet = new Set(showKeys);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setShowKeys(newSet);
  };

  const addEntry = () => {
    const newEntry: GeminiApiKeyEntry = {
      id: `gemini-api-${Date.now()}`,
      api_key: "",
      base_url: null,
      proxy_url: null,
      excluded_models: [],
      disabled: false,
    };
    onChange([...safeEntries, newEntry]);
  };

  const updateEntry = (id: string, updates: Partial<GeminiApiKeyEntry>) => {
    onChange(safeEntries.map((e) => (e.id === id ? { ...e, ...updates } : e)));
  };

  const removeEntry = (id: string) => {
    onChange(safeEntries.filter((e) => e.id !== id));
  };

  const addExclusion = (id: string) => {
    if (!exclusionInput.trim()) return;
    const entry = safeEntries.find((e) => e.id === id);
    if (entry) {
      const currentExcluded = Array.isArray(entry.excluded_models)
        ? entry.excluded_models
        : [];
      updateEntry(id, {
        excluded_models: [...currentExcluded, exclusionInput.trim()],
      });
      setExclusionInput("");
    }
  };

  const removeExclusion = (id: string, model: string) => {
    const entry = safeEntries.find((e) => e.id === id);
    if (entry) {
      const currentExcluded = Array.isArray(entry.excluded_models)
        ? entry.excluded_models
        : [];
      updateEntry(id, {
        excluded_models: currentExcluded.filter((m) => m !== model),
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5 text-sky-600" />
          <div>
            <h3 className="text-sm font-medium">Gemini API Key 多账号</h3>
            <p className="text-xs text-muted-foreground">
              配置多个 Gemini API Key 实现负载均衡
            </p>
          </div>
        </div>
        <button
          onClick={addEntry}
          className={`flex items-center gap-1 px-3 py-1.5 ${primaryActionButtonClassName}`}
        >
          <Plus className="h-4 w-4" />
          添加
        </button>
      </div>

      {safeEntries.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          <p>暂无 Gemini API Key</p>
          <p className="text-xs mt-1">点击上方"添加"按钮添加 API Key</p>
        </div>
      ) : (
        <div className="space-y-3">
          {safeEntries.map((entry) => {
            // 确保 excluded_models 是数组
            const excludedModels = Array.isArray(entry.excluded_models)
              ? entry.excluded_models
              : [];
            return (
              <div
                key={entry.id}
                className={`rounded-lg border p-4 space-y-3 ${
                  entry.disabled ? "opacity-60 bg-muted/30" : ""
                }`}
              >
                {/* Header */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium font-mono">
                    {entry.id}
                  </span>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={entry.disabled}
                        onChange={(e) =>
                          updateEntry(entry.id, { disabled: e.target.checked })
                        }
                        className="w-3 h-3"
                      />
                      禁用
                    </label>
                    <button
                      onClick={() => removeEntry(entry.id)}
                      className="p-1 rounded hover:bg-red-100 text-red-500"
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* API Key */}
                <div>
                  <label className="block text-xs font-medium mb-1">
                    API Key
                  </label>
                  <div className="relative">
                    <input
                      type={showKeys.has(entry.id) ? "text" : "password"}
                      value={entry.api_key || ""}
                      onChange={(e) =>
                        updateEntry(entry.id, { api_key: e.target.value })
                      }
                      placeholder="AIzaSy..."
                      className="w-full px-3 py-1.5 pr-10 rounded border bg-background text-sm font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => toggleShowKey(entry.id)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted"
                    >
                      {showKeys.has(entry.id) ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Base URL */}
                <div>
                  <label className="block text-xs font-medium mb-1">
                    <Globe className="h-3 w-3 inline mr-1" />
                    Base URL (可选)
                  </label>
                  <input
                    type="text"
                    value={entry.base_url || ""}
                    onChange={(e) =>
                      updateEntry(entry.id, {
                        base_url: e.target.value || null,
                      })
                    }
                    placeholder="https://generativelanguage.googleapis.com"
                    className="w-full px-3 py-1.5 rounded border bg-background text-sm"
                  />
                </div>

                {/* Proxy URL */}
                <div>
                  <label className="block text-xs font-medium mb-1">
                    代理 URL (可选)
                  </label>
                  <input
                    type="text"
                    value={entry.proxy_url || ""}
                    onChange={(e) =>
                      updateEntry(entry.id, {
                        proxy_url: e.target.value || null,
                      })
                    }
                    placeholder="socks5://127.0.0.1:1080"
                    className="w-full px-3 py-1.5 rounded border bg-background text-sm"
                  />
                </div>

                {/* Excluded Models */}
                <div>
                  <label className="block text-xs font-medium mb-1">
                    <Ban className="h-3 w-3 inline mr-1" />
                    排除模型
                  </label>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {excludedModels.map((model) => (
                      <span
                        key={model}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs dark:bg-red-900/30 dark:text-red-400"
                      >
                        {model}
                        <button
                          onClick={() => removeExclusion(entry.id, model)}
                          className="hover:text-red-900"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  {editingExclusions === entry.id ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={exclusionInput}
                        onChange={(e) => setExclusionInput(e.target.value)}
                        placeholder="gemini-2.5-pro 或 *-preview"
                        className="flex-1 px-2 py-1 rounded border bg-background text-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            addExclusion(entry.id);
                          }
                        }}
                      />
                      <button
                        onClick={() => addExclusion(entry.id)}
                        className="rounded border border-emerald-200 bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)] px-2 py-1 text-xs text-white shadow-sm shadow-emerald-950/15 hover:opacity-95"
                      >
                        添加
                      </button>
                      <button
                        onClick={() => {
                          setEditingExclusions(null);
                          setExclusionInput("");
                        }}
                        className="px-2 py-1 rounded border text-xs"
                      >
                        完成
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditingExclusions(entry.id)}
                      className="text-xs text-primary hover:underline"
                    >
                      + 添加排除模型
                    </button>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    支持通配符，如 *-preview 匹配所有预览模型
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
