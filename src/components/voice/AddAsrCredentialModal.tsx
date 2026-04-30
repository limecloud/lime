/**
 * @file 添加 ASR 凭证模态框
 * @description 支持添加不同类型的 ASR 服务凭证
 * @module components/voice/AddAsrCredentialModal
 */

import { useState } from "react";
import { X, Cpu, Cloud, Sparkles } from "lucide-react";
import type {
  AsrProviderType,
  WhisperModelSize,
  AsrCredentialEntry,
} from "./types";
import { ASR_PROVIDERS, WHISPER_MODELS, addAsrCredential } from "./types";

interface AddAsrCredentialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/** Provider 图标 */
const ProviderIcon = ({ type }: { type: AsrProviderType }) => {
  switch (type) {
    case "whisper_local":
    case "sensevoice_local":
      return <Cpu className="h-5 w-5" />;
    case "openai":
      return <Sparkles className="h-5 w-5" />;
    default:
      return <Cloud className="h-5 w-5" />;
  }
};

export function AddAsrCredentialModal({
  isOpen,
  onClose,
  onSuccess,
}: AddAsrCredentialModalProps) {
  const [selectedProvider, setSelectedProvider] =
    useState<AsrProviderType | null>(null);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("zh");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Whisper 配置
  const [whisperModel, setWhisperModel] = useState<WhisperModelSize>("base");

  // 讯飞配置
  const [xunfeiAppId, setXunfeiAppId] = useState("");
  const [xunfeiApiKey, setXunfeiApiKey] = useState("");
  const [xunfeiApiSecret, setXunfeiApiSecret] = useState("");

  // 百度配置
  const [baiduApiKey, setBaiduApiKey] = useState("");
  const [baiduSecretKey, setBaiduSecretKey] = useState("");

  // OpenAI 配置
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState("");

  const resetForm = () => {
    setSelectedProvider(null);
    setName("");
    setLanguage("zh");
    setWhisperModel("base");
    setXunfeiAppId("");
    setXunfeiApiKey("");
    setXunfeiApiSecret("");
    setBaiduApiKey("");
    setBaiduSecretKey("");
    setOpenaiApiKey("");
    setOpenaiBaseUrl("");
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async () => {
    if (!selectedProvider) return;

    setSubmitting(true);
    setError(null);

    try {
      const entry: Omit<AsrCredentialEntry, "id"> = {
        provider: selectedProvider,
        name: name || undefined,
        is_default: false,
        disabled: false,
        language,
        whisper_config:
          selectedProvider === "whisper_local"
            ? { model: whisperModel }
            : undefined,
        sensevoice_config:
          selectedProvider === "sensevoice_local"
            ? {
                model_id: "sensevoice-small-int8-2024-07-17",
                use_itn: true,
                num_threads: 4,
                vad_model_id: "silero-vad-onnx",
              }
            : undefined,
        xunfei_config:
          selectedProvider === "xunfei"
            ? {
                app_id: xunfeiAppId,
                api_key: xunfeiApiKey,
                api_secret: xunfeiApiSecret,
              }
            : undefined,
        baidu_config:
          selectedProvider === "baidu"
            ? { api_key: baiduApiKey, secret_key: baiduSecretKey }
            : undefined,
        openai_config:
          selectedProvider === "openai"
            ? {
                api_key: openaiApiKey,
                base_url: openaiBaseUrl || undefined,
              }
            : undefined,
      };

      console.log("[ASR] 添加凭证:", JSON.stringify(entry, null, 2));
      await addAsrCredential(entry);
      handleClose();
      onSuccess();
    } catch (e) {
      console.error("[ASR] 添加失败:", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const isFormValid = () => {
    if (!selectedProvider) return false;
    switch (selectedProvider) {
      case "whisper_local":
      case "sensevoice_local":
        return true;
      case "xunfei":
        return xunfeiAppId && xunfeiApiKey && xunfeiApiSecret;
      case "baidu":
        return baiduApiKey && baiduSecretKey;
      case "openai":
        return !!openaiApiKey;
      default:
        return false;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[linear-gradient(180deg,rgba(240,249,255,0.82)_0%,rgba(236,253,245,0.74)_52%,rgba(255,255,255,0.86)_100%)] backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">添加语音服务</h3>
          <button
            onClick={handleClose}
            className="rounded-lg p-1 hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Provider 选择 */}
        {!selectedProvider ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground mb-3">
              选择语音识别服务
            </p>
            {ASR_PROVIDERS.map((provider) => (
              <button
                key={provider.type}
                onClick={() => setSelectedProvider(provider.type)}
                className="flex w-full items-center gap-3 rounded-lg border p-3 hover:border-primary hover:bg-muted"
              >
                <div className="rounded-lg bg-muted p-2">
                  <ProviderIcon type={provider.type} />
                </div>
                <div className="text-left">
                  <div className="font-medium">{provider.label}</div>
                  <div className="text-sm text-muted-foreground">
                    {provider.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {/* 返回按钮 */}
            <button
              onClick={() => setSelectedProvider(null)}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← 返回选择
            </button>

            {/* 通用字段 */}
            <div>
              <label className="block text-sm font-medium mb-1">
                名称（可选）
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="自定义名称"
                className="w-full rounded-lg border bg-background px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">识别语言</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2"
              >
                <option value="zh">中文</option>
                <option value="en">英文</option>
                <option value="auto">自动检测</option>
              </select>
            </div>

            {/* Provider 特定字段 */}
            {selectedProvider === "whisper_local" && (
              <div>
                <label className="block text-sm font-medium mb-1">
                  模型大小
                </label>
                <select
                  value={whisperModel}
                  onChange={(e) =>
                    setWhisperModel(e.target.value as WhisperModelSize)
                  }
                  className="w-full rounded-lg border bg-background px-3 py-2"
                >
                  {WHISPER_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label} ({m.size}, {m.speed})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {selectedProvider === "xunfei" && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    App ID
                  </label>
                  <input
                    type="text"
                    value={xunfeiAppId}
                    onChange={(e) => setXunfeiAppId(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={xunfeiApiKey}
                    onChange={(e) => setXunfeiApiKey(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    API Secret
                  </label>
                  <input
                    type="password"
                    value={xunfeiApiSecret}
                    onChange={(e) => setXunfeiApiSecret(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2"
                  />
                </div>
              </>
            )}

            {selectedProvider === "baidu" && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={baiduApiKey}
                    onChange={(e) => setBaiduApiKey(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Secret Key
                  </label>
                  <input
                    type="password"
                    value={baiduSecretKey}
                    onChange={(e) => setBaiduSecretKey(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2"
                  />
                </div>
              </>
            )}

            {selectedProvider === "openai" && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={openaiApiKey}
                    onChange={(e) => setOpenaiApiKey(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Base URL（可选）
                  </label>
                  <input
                    type="text"
                    value={openaiBaseUrl}
                    onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    className="w-full rounded-lg border bg-background px-3 py-2"
                  />
                </div>
              </>
            )}

            {/* 提交按钮 */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={handleClose}
                className="rounded-lg border px-4 py-2 hover:bg-muted"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={!isFormValid() || submitting}
                className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {submitting ? "添加中..." : "添加"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
