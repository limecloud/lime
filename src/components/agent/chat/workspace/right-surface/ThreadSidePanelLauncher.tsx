import { useTranslation } from "react-i18next";
import { HeaderAction } from "@/components/app-shell/AppShell";

function ThreadSidePanelIcon() {
  return (
    <svg
      aria-hidden="true"
      className="shrink-0 rotate-180"
      focusable="false"
      height="16"
      viewBox="0 0 16 16"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4.66699 4.80859C4.95683 4.80873 5.19238 5.04412 5.19238 5.33398V10.667C5.19238 10.9569 4.95683 11.1923 4.66699 11.1924C4.37704 11.1924 4.1416 10.9569 4.1416 10.667V5.33398C4.1416 5.04403 4.37704 4.80859 4.66699 4.80859Z"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11.5 2.30762C13.1707 2.30762 14.5254 3.66235 14.5254 5.33301V10.666C14.5254 12.3367 13.1707 13.6914 11.5 13.6914H4.5C2.82934 13.6914 1.47461 12.3367 1.47461 10.666V5.33301C1.47461 3.66235 2.82934 2.30762 4.5 2.30762H11.5ZM4.5 3.3584C3.40924 3.3584 2.52539 4.24225 2.52539 5.33301V10.666C2.52539 11.7568 3.40924 12.6416 4.5 12.6416H11.5C12.5908 12.6416 13.4746 11.7568 13.4746 10.666V5.33301C13.4746 4.24225 12.5908 3.3584 11.5 3.3584H4.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ThreadSidePanelLauncher({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation("agent");
  const label = t("agentChat.rightSurface.showTabs");
  return (
    <HeaderAction
      actionId="thread-side-panel-close"
      align="end"
      divider={false}
      order={300}
      slotPosition="right"
    >
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-pressed={open}
        onClick={onToggle}
        data-testid="thread-side-panel-toggle"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[color:var(--lime-chrome-muted)] hover:bg-[color:var(--lime-chrome-tab-hover)] hover:text-[color:var(--lime-chrome-text)]"
      >
        <ThreadSidePanelIcon />
      </button>
    </HeaderAction>
  );
}
