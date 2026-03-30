import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupMountedRoots,
  flushEffects,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "../hooks/testUtils";
import { useWorkbenchRightRailActionPanelState } from "./useWorkbenchRightRailActionPanelState";

setupReactActEnvironment();

const mountedRoots: MountedRoot[] = [];

function HookHarness(props: {
  initialExpandedActionKey?: string | null;
  onInitialExpandedActionConsumed?: () => void;
}) {
  const state = useWorkbenchRightRailActionPanelState({
    initialExpandedActionKey: props.initialExpandedActionKey,
    onInitialExpandedActionConsumed: props.onInitialExpandedActionConsumed,
  });

  useEffect(() => {
    document.body.setAttribute(
      "data-expanded-action-key",
      state.expandedActionKey ?? "",
    );
  }, [state.expandedActionKey]);

  return null;
}

type HookHarnessProps = Parameters<typeof HookHarness>[0];

describe("useWorkbenchRightRailActionPanelState", () => {
  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
    document.body.removeAttribute("data-expanded-action-key");
  });

  it("应按初始参数自动展开动作面板并消费一次", async () => {
    const consumedSpy = vi.fn();
    const { rerender } = mountHarness<HookHarnessProps>(
      HookHarness,
      {
        initialExpandedActionKey: "search-material",
        onInitialExpandedActionConsumed: consumedSpy,
      },
      mountedRoots,
    );

    await flushEffects();

    expect(document.body.getAttribute("data-expanded-action-key")).toBe(
      "search-material",
    );
    expect(consumedSpy).toHaveBeenCalledTimes(1);

    rerender({
      initialExpandedActionKey: null,
      onInitialExpandedActionConsumed: consumedSpy,
    });

    await flushEffects();

    expect(document.body.getAttribute("data-expanded-action-key")).toBe(
      "search-material",
    );
    expect(consumedSpy).toHaveBeenCalledTimes(1);
  });
});
