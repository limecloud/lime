import { ArrowLeft, ArrowRight, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppNavigationRequest } from "@/contexts/AppNavigationContext";
import { SettingsTabs } from "@/types/settings";

const navigationButton =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40";
const breadcrumbButton =
  "rounded px-1 py-0.5 text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";

export function BrowserManagementHeader({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  const { t } = useTranslation("settings");
  const navigate = useAppNavigationRequest();
  return (
    <header
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2"
      data-testid="browser-management-header"
    >
      <div
        role="group"
        aria-label={t("browserManagement.navigation")}
        className="flex shrink-0 items-center gap-px"
      >
        <button
          type="button"
          className={navigationButton}
          aria-label={t("browserManagement.back")}
          title={t("browserManagement.back")}
          onClick={onBack}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={navigationButton}
          aria-label={t("browserManagement.forward")}
          title={t("browserManagement.forward")}
          disabled
        >
          <ArrowRight className="size-4" aria-hidden="true" />
        </button>
      </div>
      <nav
        aria-label={t("browserManagement.breadcrumbs")}
        className="min-w-0 text-sm"
      >
        <ol className="flex min-w-0 flex-wrap items-center gap-1">
          <li>
            <button
              type="button"
              className={breadcrumbButton}
              disabled={!navigate}
              onClick={() =>
                navigate?.("settings", { tab: SettingsTabs.General })
              }
            >
              {t("browserManagement.settings")}
            </button>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-3 text-muted-foreground" />
          </li>
          <li>
            <button type="button" className={breadcrumbButton} onClick={onBack}>
              {t("settings.tab.browser")}
            </button>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-3 text-muted-foreground" />
          </li>
          <li className="min-w-0" aria-current="page">
            <h1 className="break-words font-medium">{title}</h1>
          </li>
        </ol>
      </nav>
    </header>
  );
}
