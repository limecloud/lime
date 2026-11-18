import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Page, PageParams } from "@/types/page";
import {
  SettingsPageBody,
  SettingsPageHeader,
} from "../../SettingsPrimitives";
import { McpServerManager } from "./McpServerManager";
import { useMcpSettings } from "./useMcpSettings";

export function McpServersSettings({
  onNavigate,
  embedded = false,
}: {
  onNavigate?: (page: Page, params?: PageParams) => void;
  embedded?: boolean;
}) {
  const { t } = useTranslation("settings");
  const controller = useMcpSettings();
  const [, setEditing] = useState(false);
  const content = (
    <>
      <p className={embedded ? "text-[13px] text-muted-foreground" : "-mt-6 text-[13px] text-muted-foreground"}>
        {t("settings.mcp.description")}
      </p>
      <McpServerManager
        controller={controller}
        onEditingChange={setEditing}
        onNavigate={onNavigate}
      />
    </>
  );
  if (embedded) {
    return (
      <section className="flex flex-col gap-3" data-testid="settings-mcp-section">
        <h2 className="text-[15px] font-medium">{t("settings.mcp.title")}</h2>
        {content}
      </section>
    );
  }
  return (
    <SettingsPageBody data-testid="settings-mcp-page">
      <SettingsPageHeader title={t("settings.mcp.title")} />
      {content}
    </SettingsPageBody>
  );
}
