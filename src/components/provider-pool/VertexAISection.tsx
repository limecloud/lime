import { useState } from "react";
import {
  Plus,
  Trash2,
  Key,
  Globe,
  Eye,
  EyeOff,
  ArrowRight,
} from "lucide-react";
import type {
  VertexApiKeyEntry,
  VertexModelAlias,
} from "@/lib/api/providerRuntime";

interface VertexAISectionProps {
  entries: VertexApiKeyEntry[] | undefined;
  onChange: (entries: VertexApiKeyEntry[]) => void;
}

export function VertexAISection({
  entries = [],
  onChange,
}: VertexAISectionProps) {
  const primaryActionButtonClassName =
    "rounded-lg border border-emerald-200 bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)] text-sm text-white shadow-sm shadow-emerald-950/15 hover:opacity-95";
  // 确保 entries 是数组
  const safeEntries = Array.isArray(entries) ? entries : [];
  const [showKeys, setShowKeys] = useState<Set<string>>(new Set());
  const [editingAliases, setEditingAliases] = useState<string | null>(null);
  const [aliasName, setAliasName] = useState("");
  const [aliasAlias, setAliasAlias] = useState("");

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
    const newEntry: VertexApiKeyEntry = {
      id: `vertex-${Date.now()}`,
      api_key: "",
      base_url: null,
      models: [],
      proxy_url: null,
      disabled: false,
    };
    onChange([...safeEntries, newEntry]);
  };

  const updateEntry = (id: string, updates: Partial<VertexApiKeyEntry>) => {
    onChange(safeEntries.map((e) => (e.id === id ? { ...e, ...updates } : e)));
  };

  const removeEntry = (id: string) => {
    onChange(safeEntries.filter((e) => e.id !== id));
  };

  const addAlias = (id: string) => {
    if (!aliasName.trim() || !aliasAlias.trim()) return;
    const entry = safeEntries.find((e) => e.id === id);
    if (entry) {
      const newAlias: VertexModelAlias = {
        name: aliasName.trim(),
        alias: aliasAlias.trim(),
      };
      const currentModels = Array.isArray(entry.models) ? entry.models : [];
      updateEntry(id, {
        models: [...currentModels, newAlias],
      });
      setAliasName("");
      setAliasAlias("");
    }
  };

  const removeAlias = (id: string, aliasToRemove: string) => {
    const entry = safeEntries.find((e) => e.id === id);
    if (entry) {
      const currentModels = Array.isArray(entry.models) ? entry.models : [];
      updateEntry(id, {
        models: currentModels.filter((m) => m.alias !== aliasToRemove),
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5 text-green-500" />
          <div>
            <h3 className="text-sm font-medium">Vertex AI</h3>
            <p className="text-xs text-muted-foreground">
              配置 Google Vertex AI API Key 和模型别名
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
          <p>暂无 Vertex AI 凭证</p>
          <p className="text-xs mt-1">点击上方"添加"按钮添加凭证</p>
        </div>
      ) : (
        <div className="space-y-3">
          {safeEntries.map((entry) => {
            // 确保 models 是数组
            const models = Array.isArray(entry.models) ? entry.models : [];
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
                      placeholder="vk-..."
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
                    Base URL
                  </label>
                  <input
                    type="text"
                    value={entry.base_url || ""}
                    onChange={(e) =>
                      updateEntry(entry.id, {
                        base_url: e.target.value || null,
                      })
                    }
                    placeholder="https://example.com/api"
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

                {/* Model Aliases */}
                <div>
                  <label className="block text-xs font-medium mb-1">
                    模型别名映射
                  </label>
                  <div className="space-y-1 mb-2">
                    {models.map((model) => (
                      <div
                        key={model.alias}
                        className="flex items-center gap-2 px-2 py-1 rounded bg-muted/50 text-sm"
                      >
                        <span className="font-mono text-xs">{model.alias}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <span className="font-mono text-xs text-primary">
                          {model.name}
                        </span>
                        <button
                          onClick={() => removeAlias(entry.id, model.alias)}
                          className="ml-auto text-red-500 hover:text-red-700"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  {editingAliases === entry.id ? (
                    <div className="space-y-2">
                      <div className="flex gap-2 items-center">
                        <input
                          type="text"
                          value={aliasAlias}
                          onChange={(e) => setAliasAlias(e.target.value)}
                          placeholder="客户端别名"
                          className="flex-1 px-2 py-1 rounded border bg-background text-sm"
                        />
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        <input
                          type="text"
                          value={aliasName}
                          onChange={(e) => setAliasName(e.target.value)}
                          placeholder="上游模型名"
                          className="flex-1 px-2 py-1 rounded border bg-background text-sm"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => addAlias(entry.id)}
                          className="rounded border border-emerald-200 bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)] px-2 py-1 text-xs text-white shadow-sm shadow-emerald-950/15 hover:opacity-95"
                        >
                          添加
                        </button>
                        <button
                          onClick={() => {
                            setEditingAliases(null);
                            setAliasName("");
                            setAliasAlias("");
                          }}
                          className="px-2 py-1 rounded border text-xs"
                        >
                          完成
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditingAliases(entry.id)}
                      className="text-xs text-primary hover:underline"
                    >
                      + 添加模型别名
                    </button>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    将客户端请求的模型名映射到上游实际模型名
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
