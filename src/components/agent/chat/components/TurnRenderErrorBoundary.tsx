import { Component, type ErrorInfo, type ReactNode } from "react";
import { getLimeI18n } from "@/i18n/createI18n";

interface TurnRenderErrorBoundaryProps {
  children: ReactNode;
  turnId: string;
}

interface TurnRenderErrorBoundaryState {
  hasError: boolean;
}

export class TurnRenderErrorBoundary extends Component<
  TurnRenderErrorBoundaryProps,
  TurnRenderErrorBoundaryState
> {
  state: TurnRenderErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): TurnRenderErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("会话回合渲染失败:", error, info.componentStack);
  }

  componentDidUpdate(prevProps: TurnRenderErrorBoundaryProps): void {
    if (prevProps.turnId !== this.props.turnId && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    const t = getLimeI18n().t.bind(getLimeI18n());
    return (
      <div
        className="my-2 flex items-center justify-between gap-3 rounded-lg border border-[color:var(--lime-surface-border)] px-3 py-2 text-xs text-[color:var(--lime-text-muted)]"
        data-testid="turn-render-error"
        data-runtime-turn-id={this.props.turnId}
      >
        <span>
          {String(
            t("agentChat.messageList.turnRenderError", {
              defaultValue: "此回合渲染失败",
            }),
          )}
        </span>
        <button
          type="button"
          className="rounded px-2 py-0.5 font-medium text-[color:var(--lime-text-strong)] hover:bg-[color:var(--lime-surface-subtle)]"
          data-testid="turn-render-error-retry"
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
