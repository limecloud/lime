import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { modelRegistryApi } from "@/lib/api/modelRegistry";
import type { KnownModelReasoningEffort } from "@/lib/model/modelReasoningPolicy";
import {
  BASE_REASONING_EFFORTS,
  OPTIONAL_REASONING_EFFORTS,
  enabledReasoningEfforts,
} from "@/lib/model/reasoningEffortPreferences";
import {
  SettingsAction,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
} from "../../SettingsPrimitives";

const TARGET = "configuration-reasoning-efforts";
export function ModelFeaturesSection({
  value,
  disabled,
  error,
  onChange,
}: {
  value: readonly KnownModelReasoningEffort[] | null | undefined;
  disabled: boolean;
  error: ReactNode;
  onChange: (next: KnownModelReasoningEffort[]) => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const [supported, setSupported] = useState<string[] | null>(null);
  const [readError, setReadError] = useState(false);
  const generation = useRef(0);
  const active = useRef(false);
  const load = useCallback(async () => {
    const request = ++generation.current;
    try {
      const models = await modelRegistryApi.getModelRegistry();
      if (active.current && generation.current === request) {
        setSupported([
          ...new Set(
            models.flatMap(
              (model) =>
                model.reasoning_policy?.supported_reasoning_efforts ?? [],
            ),
          ),
        ]);
        setReadError(false);
      }
    } catch {
      if (active.current && generation.current === request) setReadError(true);
    }
  }, []);
  useEffect(() => {
    active.current = true;
    const stop = modelRegistryApi.subscribeModelRegistryUpdates(
      () => void load(),
    );
    void load();
    return () => {
      active.current = false;
      stop();
    };
  }, [load]);
  const optional = OPTIONAL_REASONING_EFFORTS.filter((effort) =>
    supported?.includes(effort),
  );
  const persistent = supported?.includes("persistent");
  if (!readError && optional.length === 0 && !persistent) return null;
  const mandatory: KnownModelReasoningEffort[] = [
    ...BASE_REASONING_EFFORTS,
    ...(persistent ? ["persistent" as const] : []),
  ];
  const enabled = enabledReasoningEfforts(value);
  return (
    <SettingsSection title={t("settings.configuration.modelFeatures.title")}>
      <SettingsGroup>
        <SettingsRow
          targetId={TARGET}
          label={t("settings.configuration.modelFeatures.label")}
          description={
            <>
              {t("settings.configuration.modelFeatures.description")}
              {readError ? (
                <div role="alert" className="mt-1 text-destructive">
                  {t("settings.configuration.modelFeatures.loadError")}{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void load()}
                  >
                    {t("settings.browser.retry")}
                  </button>
                </div>
              ) : null}
              {error}
            </>
          }
        >
          <Menu.Root>
            <Menu.Trigger asChild>
              <SettingsAction
                type="button"
                disabled={disabled || readError || supported === null}
                aria-labelledby={`${TARGET}-label ${TARGET}-value`}
                aria-describedby={`${TARGET}-description`}
              >
                <span id={`${TARGET}-value`}>
                  {t("settings.configuration.modelFeatures.selected", {
                    count:
                      mandatory.length +
                      optional.filter((effort) => enabled.includes(effort))
                        .length,
                  })}
                </span>
                <ChevronDown aria-hidden="true" />
              </SettingsAction>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content
                align="end"
                sideOffset={4}
                className="z-[70] min-w-44 rounded-xl border border-border bg-popover p-1 text-[13px] text-popover-foreground shadow-lg"
              >
                {[...mandatory, ...optional].map((effort) => (
                  <Menu.CheckboxItem
                    key={effort}
                    checked={
                      mandatory.includes(effort) || enabled.includes(effort)
                    }
                    disabled={disabled || mandatory.includes(effort)}
                    onCheckedChange={(checked) => {
                      if (disabled || mandatory.includes(effort)) return;
                      onChange(
                        checked
                          ? [...new Set([...enabled, effort])]
                          : enabled.filter((item) => item !== effort),
                      );
                    }}
                    onSelect={(event) => event.preventDefault()}
                    className="flex min-h-7 cursor-default items-center justify-between gap-4 rounded-lg px-2 py-1 outline-none focus:bg-accent data-[disabled]:opacity-50"
                  >
                    {t(`common.modelSelector.reasoning.level.${effort}`, {
                      ns: "common",
                    })}
                    <Menu.ItemIndicator>
                      <Check aria-hidden="true" className="size-3.5" />
                    </Menu.ItemIndicator>
                  </Menu.CheckboxItem>
                ))}
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  );
}
