import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HeaderAction } from "@/components/app-shell/AppShell";

export function ThreadSidePanelLauncher({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation("agent");
  const label = t(
    open
      ? "agentChat.rightSurface.closePanel"
      : "agentChat.rightSurface.openPanel",
  );
  return (
    <HeaderAction
      actionId="thread-side-panel-close"
      align="end"
      order={300}
      slotPosition="right"
    >
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={onToggle}
        data-testid="thread-side-panel-toggle"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[color:var(--lime-chrome-muted)] hover:bg-[color:var(--lime-chrome-tab-hover)] hover:text-[color:var(--lime-chrome-text)]"
      >
        {open ? (
          <PanelRightClose size={16} aria-hidden="true" />
        ) : (
          <PanelRightOpen size={16} aria-hidden="true" />
        )}
      </button>
    </HeaderAction>
  );
}
