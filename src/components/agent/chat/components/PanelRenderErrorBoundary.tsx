import { Component, type ErrorInfo, type ReactNode } from "react";
import { getLimeI18n } from "@/i18n/createI18n";

interface PanelRenderErrorBoundaryProps {
  children: ReactNode;
  messageKey: string;
  defaultMessage: string;
  testId: string;
}

interface PanelRenderErrorBoundaryState {
  hasError: boolean;
}

export class PanelRenderErrorBoundary extends Component<
  PanelRenderErrorBoundaryProps,
  PanelRenderErrorBoundaryState
> {
  state: PanelRenderErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): PanelRenderErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("面板渲染失败:", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    const t = getLimeI18n().t.bind(getLimeI18n());
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--lime-surface-border)] px-3 py-2 text-xs text-[color:var(--lime-text-muted)]"
        data-testid={this.props.testId}
      >
        <span>
          {String(
            t(this.props.messageKey, {
              defaultValue: this.props.defaultMessage,
            }),
          )}
        </span>
        <button
          type="button"
          className="rounded px-2 py-0.5 font-medium text-[color:var(--lime-text-strong)] hover:bg-[color:var(--lime-surface-subtle)]"
          onClick={() => this.setState({ hasError: false })}
        >
          {String(
            t("agentChat.messageList.actions.retry", {
              defaultValue: "重试",
            }),
          )}
        </button>
      </div>
    );
  }
}
