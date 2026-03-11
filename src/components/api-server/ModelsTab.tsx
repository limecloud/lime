import { useState, useEffect, useMemo } from "react";
import { Cpu, RefreshCw, Copy, Check, Search } from "lucide-react";
import { getAvailableModels, type ModelInfo } from "@/lib/api/modelCatalog";

// 根据 provider_id 获取分组配置
const PROVIDER_GROUPS: Record<string, { name: string; color: string }> = {
  anthropic: {
    name: "Anthropic",
    color:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  },
  google: {
    name: "Google",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  },
  openai: {
    name: "OpenAI",
    color:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  },
  dashscope: {
    name: "阿里云",
    color:
      "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  },
  deepseek: {
    name: "DeepSeek",
    color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
  },
  zhipu: {
    name: "智谱",
    color:
      "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  },
  moonshot: {
    name: "月之暗面",
    color:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  },
  mistral: {
    name: "Mistral",
    color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  },
  cohere: {
    name: "Cohere",
    color: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
  },
};

export function ModelsTab() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  useEffect(() => {
    fetchModels();
  }, []);

  const fetchModels = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await getAvailableModels();
      setModels(data || []);
    } catch (e: any) {
      setError(e.toString());
      setModels([]);
    }

    setLoading(false);
  };

  const copyModelId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const getProviderBadge = (providerId: string) => {
    const config = PROVIDER_GROUPS[providerId];
    if (!config) {
      return (
        <span className="rounded px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
          {providerId}
        </span>
      );
    }
    return (
      <span
        className={`rounded px-2 py-0.5 text-xs font-medium ${config.color}`}
      >
        {config.name}
      </span>
    );
  };

  // 按 provider 分组统计
  const providerCounts = useMemo(() => {
    return models.reduce(
      (acc, model) => {
        const provider = model.owned_by;
        acc[provider] = (acc[provider] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
  }, [models]);

  // 获取所有 provider 列表（按数量排序）
  const providers = useMemo(() => {
    return Object.entries(providerCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
  }, [providerCounts]);

  // 过滤模型
  const filteredModels = useMemo(() => {
    return models.filter((model) => {
      const matchesSearch = model.id
        .toLowerCase()
        .includes(search.toLowerCase());
      const matchesProvider =
        !selectedProvider || model.owned_by === selectedProvider;
      return matchesSearch && matchesProvider;
    });
  }, [models, search, selectedProvider]);

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-500 bg-red-50 p-4 text-red-700 dark:bg-red-950/30">
          {error}
        </div>
      )}

      {/* 搜索和过滤 */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索模型..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border bg-background pl-10 pr-4 py-2 text-sm"
          />
        </div>
        <button
          onClick={fetchModels}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>

      {/* Provider 过滤标签 */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedProvider(null)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            !selectedProvider
              ? "bg-primary text-primary-foreground"
              : "bg-muted hover:bg-muted/80"
          }`}
        >
          全部 ({models.length})
        </button>
        {providers.map((providerId) => {
          const count = providerCounts[providerId] || 0;
          const config = PROVIDER_GROUPS[providerId];
          return (
            <button
              key={providerId}
              onClick={() =>
                setSelectedProvider(
                  selectedProvider === providerId ? null : providerId,
                )
              }
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                selectedProvider === providerId
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80"
              }`}
            >
              {config?.name || providerId} ({count})
            </button>
          );
        })}
      </div>

      {/* 模型列表 */}
      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="font-medium">模型列表</span>
            <span className="text-sm text-muted-foreground">
              {filteredModels.length} 个模型
            </span>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredModels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Cpu className="h-12 w-12 mb-2 opacity-50" />
            <p>暂无模型数据</p>
          </div>
        ) : (
          <div className="divide-y">
            {filteredModels.map((model) => (
              <div
                key={model.id}
                className="flex items-center justify-between px-4 py-3 hover:bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  <Cpu className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="flex items-center gap-2">
                      <code className="font-medium">{model.id}</code>
                      {getProviderBadge(model.owned_by)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {model.owned_by}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => copyModelId(model.id)}
                  className="rounded p-2 hover:bg-muted"
                  title="复制模型 ID"
                >
                  {copied === model.id ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 使用说明 */}
      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-2 font-semibold">使用说明</h3>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>• 点击模型 ID 右侧的复制按钮可快速复制模型名称</p>
          <p>
            • 在 API 请求中使用{" "}
            <code className="rounded bg-muted px-1">model</code> 参数指定模型
          </p>
          <p>• 不同 Provider 支持的模型不同，请确保已配置对应的凭证</p>
        </div>
      </div>
    </div>
  );
}
