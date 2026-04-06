import React, { memo, useState } from "react";
import {
  GeneralWorkbenchSidebarShell,
  type GeneralWorkbenchSidebarTab,
} from "./GeneralWorkbenchSidebarShell";
import { GeneralWorkbenchSidebarPanels } from "./GeneralWorkbenchSidebarPanels";
import { buildGeneralWorkbenchSidebarOrchestrationSource } from "./buildGeneralWorkbenchSidebarOrchestrationSource";
import { createGeneralWorkbenchSidebarOrchestrationInput } from "./generalWorkbenchSidebarOrchestrationContract";
import { type GeneralWorkbenchSidebarProps } from "./generalWorkbenchSidebarContract";
import { areGeneralWorkbenchSidebarPropsEqual } from "./generalWorkbenchSidebarComparator";
import { useGeneralWorkbenchSidebarOrchestration } from "./useGeneralWorkbenchSidebarOrchestration";

function GeneralWorkbenchSidebarComponent({
  branchMode = "version",
  onRequestCollapse,
  headerActionSlot,
  topSlot,
  ...props
}: GeneralWorkbenchSidebarProps) {
  const [activeTab, setActiveTab] =
    useState<GeneralWorkbenchSidebarTab>("context");
  const isVersionMode = branchMode === "version";
  const orchestrationInput = createGeneralWorkbenchSidebarOrchestrationInput(
    buildGeneralWorkbenchSidebarOrchestrationSource({
      isVersionMode,
      props,
    }),
  );
  const {
    branchCount,
    activeContextCount,
    visibleExecLogCount,
    contextPanelProps,
    workflowPanelProps,
    execLogProps,
  } = useGeneralWorkbenchSidebarOrchestration({
    activeTab,
    input: orchestrationInput,
  });

  return (
    <GeneralWorkbenchSidebarShell
      activeTab={activeTab}
      isVersionMode={isVersionMode}
      activeContextCount={activeContextCount}
      branchCount={branchCount}
      visibleExecLogCount={visibleExecLogCount}
      onTabChange={setActiveTab}
      onRequestCollapse={onRequestCollapse}
      headerActionSlot={headerActionSlot}
      topSlot={topSlot}
    >
      <GeneralWorkbenchSidebarPanels
        activeTab={activeTab}
        contextPanelProps={contextPanelProps}
        workflowPanelProps={workflowPanelProps}
        execLogProps={execLogProps}
      />
    </GeneralWorkbenchSidebarShell>
  );
}

export const GeneralWorkbenchSidebar = memo(
  GeneralWorkbenchSidebarComponent,
  areGeneralWorkbenchSidebarPropsEqual,
);
