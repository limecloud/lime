import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ProviderWithKeysDisplay,
  UpdateProviderRequest,
} from "@/lib/api/apiKeyProvider";

// Lime 多协议适配；复用现役 Provider 更新合同，不创建第二份配置。
export function ProviderProtocolSelect({
  provider,
  disabled,
  onUpdate,
}: {
  provider: ProviderWithKeysDisplay;
  disabled?: boolean;
  onUpdate?: (id: string, request: UpdateProviderRequest) => Promise<void>;
}) {
  const { t } = useTranslation("settings");
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  if (provider.type !== "openai" && provider.type !== "openai-response") {
    return null;
  }

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        {t("settings.providers.protocol.label")}
      </label>
      <select
        id={id}
        value={provider.type}
        disabled={disabled || !onUpdate || saving}
        className="h-10 w-full rounded-md border-[0.5px] border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] px-3 text-sm text-[color:var(--lime-text-strong)] disabled:opacity-50"
        onChange={async (event) => {
          const type = event.target.value;
          if (!onUpdate || type === provider.type) return;
          setSaving(true);
          setFailed(false);
          try {
            await onUpdate(provider.id, { type });
          } catch {
            setFailed(true);
          } finally {
            setSaving(false);
          }
        }}
      >
        <option value="openai">
          {t("settings.providers.protocol.chatCompletions")}
        </option>
        <option value="openai-response">
          {t("settings.providers.protocol.responses")}
        </option>
      </select>
      {failed ? (
        <p role="alert" className="text-sm text-[color:var(--lime-danger)]">
          {t("settings.providers.protocol.saveFailed")}
        </p>
      ) : null}
    </div>
  );
}
