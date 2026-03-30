import { useEffect, useState } from "react";

interface UseWorkbenchRightRailActionPanelStateParams {
  initialExpandedActionKey?: string | null;
  onInitialExpandedActionConsumed?: () => void;
}

export function useWorkbenchRightRailActionPanelState({
  initialExpandedActionKey,
  onInitialExpandedActionConsumed,
}: UseWorkbenchRightRailActionPanelStateParams) {
  const [expandedActionKey, setExpandedActionKey] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!initialExpandedActionKey) {
      return;
    }
    setExpandedActionKey(initialExpandedActionKey);
    onInitialExpandedActionConsumed?.();
  }, [initialExpandedActionKey, onInitialExpandedActionConsumed]);

  const closeExpandedAction = () => {
    setExpandedActionKey(null);
  };

  const handleToggleActionPanel = (
    actionKey: string,
    beforeToggle?: () => void,
  ) => {
    beforeToggle?.();
    setExpandedActionKey((previous) =>
      previous === actionKey ? null : actionKey,
    );
  };

  return {
    closeExpandedAction,
    expandedActionKey,
    handleToggleActionPanel,
  };
}
