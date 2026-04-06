import { useCallback, useMemo, useState } from "react";
import type { SkillDetailInfo } from "@/lib/api/skill-execution";
import type { Message } from "../types";
import type {
  GeneralWorkbenchActivityLogGroup,
  GeneralWorkbenchCreationTaskGroup,
} from "./generalWorkbenchWorkflowData";
import {
  buildGeneralWorkbenchExecLogEntries,
  filterGeneralWorkbenchExecLogEntries,
} from "./generalWorkbenchExecLogData";

interface UseGeneralWorkbenchExecLogStateParams {
  messages: Message[];
  groupedActivityLogs: GeneralWorkbenchActivityLogGroup[];
  groupedCreationTaskEvents: GeneralWorkbenchCreationTaskGroup[];
  skillDetailMap: Record<string, SkillDetailInfo | null>;
}

export interface GeneralWorkbenchExecLogState {
  execLogEntries: ReturnType<typeof buildGeneralWorkbenchExecLogEntries>;
  visibleExecLogEntries: ReturnType<typeof buildGeneralWorkbenchExecLogEntries>;
  wasExecLogCleared: boolean;
  clearExecLog: () => void;
}

export function useGeneralWorkbenchExecLogState({
  messages,
  groupedActivityLogs,
  groupedCreationTaskEvents,
  skillDetailMap,
}: UseGeneralWorkbenchExecLogStateParams): GeneralWorkbenchExecLogState {
  const [execLogClearedAt, setExecLogClearedAt] = useState<number | null>(null);

  const execLogEntries = useMemo(
    () =>
      buildGeneralWorkbenchExecLogEntries({
        messages,
        groupedActivityLogs,
        groupedCreationTaskEvents,
        skillDetailMap,
      }),
    [messages, groupedActivityLogs, groupedCreationTaskEvents, skillDetailMap],
  );

  const visibleExecLogEntries = useMemo(
    () => filterGeneralWorkbenchExecLogEntries(execLogEntries, execLogClearedAt),
    [execLogClearedAt, execLogEntries],
  );

  const clearExecLog = useCallback(() => {
    setExecLogClearedAt(Date.now());
  }, []);

  return {
    execLogEntries,
    visibleExecLogEntries,
    wasExecLogCleared: execLogClearedAt !== null,
    clearExecLog,
  };
}
