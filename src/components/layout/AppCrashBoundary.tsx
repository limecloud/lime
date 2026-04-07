import React from "react";
import { reportFrontendError } from "@/lib/crashReporting";
import { CrashRecoveryPanel } from "./CrashRecoveryPanel";

interface AppCrashBoundaryProps {
  children: React.ReactNode;
}

interface AppCrashBoundaryState {
  hasError: boolean;
  error: Error | null;
  componentStack: string;
  resetToken: number;
}

export class AppCrashBoundary extends React.Component<
  AppCrashBoundaryProps,
  AppCrashBoundaryState
> {
  constructor(props: AppCrashBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      componentStack: "",
      resetToken: 0,
    };
  }

  static getDerivedStateFromError(
    error: Error,
  ): Partial<AppCrashBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const componentStack = info.componentStack || "";
    this.setState({ componentStack });

    void reportFrontendError(error, {
      source: "app-crash-boundary",
      workflow_step: "root_render",
      component: "AppCrashBoundary",
      component_stack: componentStack,
      page_url:
        typeof window !== "undefined" ? window.location.href : "unknown",
    });
  }

  private handleRetry = () => {
    this.setState((previous) => ({
      hasError: false,
      error: null,
      componentStack: "",
      resetToken: previous.resetToken + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <CrashRecoveryPanel
          error={this.state.error}
          componentStack={this.state.componentStack}
          onRetry={this.handleRetry}
        />
      );
    }

    return (
      <React.Fragment key={this.state.resetToken}>
        {this.props.children}
      </React.Fragment>
    );
  }
}
