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
}: {
  onNavigate?: (page: Page, params?: PageParams) => void;
}) {
  const { t } = useTranslation("settings");
  const controller = useMcpSettings();
  const [, setEditing] = useState(false);
  return (
    <SettingsPageBody data-testid="settings-mcp-page">
      <SettingsPageHeader title={t("settings.mcp.title")} />
      <p className="-mt-6 text-[13px] text-muted-foreground">
        {t("settings.mcp.description")}
      </p>
      <McpServerManager
        controller={controller}
        onEditingChange={setEditing}
        onNavigate={onNavigate}
      />
    </SettingsPageBody>
  );
}
