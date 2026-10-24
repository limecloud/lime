import { Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { HarnessSessionState } from "../utils/harnessState";
import type { HarnessEnvironmentSummary } from "./HarnessActivityTypes";
import {
  ActionableBadge,
  InteractiveText,
} from "./HarnessStatusPanelPrimitives";
import {
  HarnessStatusSection as Section,
  type HarnessSectionKey,
} from "./HarnessStatusSectionFrame";
import { agentText } from "./harnessPanelText";

interface HarnessContextCapabilitiesSectionsProps {
  latestContextTrace: HarnessSessionState["latestContextTrace"];
  activity: HarnessSessionState["activity"];
  environment: HarnessEnvironmentSummary;
  registerSectionRef: (
    key: HarnessSectionKey,
    node: HTMLElement | null,
  ) => void;
  handleOpenExternalLink: (url: string) => void | Promise<void>;
  handleOpenPathValue: (path: string) => void | Promise<void>;
}

export function HarnessContextCapabilitiesSections({
  latestContextTrace,
  activity,
  environment,
  registerSectionRef,
  handleOpenExternalLink,
  handleOpenPathValue,
}: HarnessContextCapabilitiesSectionsProps) {
  return (
    <>
      {latestContextTrace.length > 0 ? (
        <Section
          sectionKey="context"
          title={agentText(
            "agentChat.harness.generated.674960a8f7",
            "最新上下文轨迹",
          )}
          badge={`${latestContextTrace.length} 步`}
          registerRef={registerSectionRef}
        >
          <div className="space-y-2">
            {latestContextTrace.map((step, index) => (
              <div
                key={`${step.stage}-${index}`}
                className="rounded-lg border border-border bg-background px-3 py-2"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Workflow className="h-4 w-4 text-muted-foreground" />
                  <span>{step.stage}</span>
                </div>
                <InteractiveText
                  text={step.detail}
                  className="mt-1 text-xs text-muted-foreground"
                  onOpenUrl={handleOpenExternalLink}
                />
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {environment.skillsCount > 0 ? (
        <Section
          sectionKey="capabilities"
          title={agentText(
            "agentChat.harness.generated.bc407ad9b5",
            "已激活技能",
          )}
          badge={`${environment.skillsCount} 个技能`}
          registerRef={registerSectionRef}
        >
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {environment.skillNames.map((name) => (
                <ActionableBadge
                  key={name}
                  variant="secondary"
                  value={name}
                  onOpenUrl={handleOpenExternalLink}
                  onOpenPath={handleOpenPathValue}
                />
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {environment.memorySignals.length > 0 ? (
                environment.memorySignals.map((signal) => (
                  <ActionableBadge
                    key={signal}
                    variant="outline"
                    value={signal}
                    onOpenUrl={handleOpenExternalLink}
                    onOpenPath={handleOpenPathValue}
                  />
                ))
              ) : (
                <span className="text-xs text-muted-foreground">
                  {agentText(
                    "agentChat.harness.generated.570b39776f",
                    "当前未识别到持久记忆信号",
                  )}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {agentText("agentChat.harness.generated.6c09b4e917", "规划")}
                {activity.planning}
              </Badge>
              <Badge variant="outline">
                {agentText("agentChat.harness.generated.49deaf7da2", "文件")}
                {activity.filesystem}
              </Badge>
              <Badge variant="outline">
                {agentText("agentChat.harness.generated.28febba225", "执行")}
                {activity.execution}
              </Badge>
              <Badge variant="outline">
                {agentText("agentChat.harness.generated.06caf5dc95", "网页")}
                {activity.web}
              </Badge>
              <Badge variant="outline">
                {agentText("agentChat.harness.generated.53da139b6a", "技能")}
                {activity.skills}
              </Badge>
              <Badge variant="outline">
                {agentText("agentChat.harness.generated.b78f388086", "委派")}
                {activity.delegation}
              </Badge>
            </div>
          </div>
        </Section>
      ) : null}
    </>
  );
}
