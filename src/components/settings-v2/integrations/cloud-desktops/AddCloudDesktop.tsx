import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { useTranslation } from "react-i18next";
import type { CloudDesktopResource } from "@limecloud/app-server-client";
import { requestCloudDesktop } from "@/lib/api/cloud";
import { SettingsAction } from "../../SettingsPrimitives";
import { CloudSelect, Field, inputClass } from "./CloudDesktopPrimitives";
import { PurchaseWuying } from "./PurchaseWuying";
import { PurchaseEcs } from "./PurchaseEcs";
import { initialEcsSpec, initialWuyingSpec } from "./purchaseSpecs";
import { useCloudPurchase } from "./useCloudPurchase";

export const cloudTabClass =
  "rounded-lg px-3 py-2 text-[13px] text-muted-foreground outline-none hover:text-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

export function AddCloudDesktop({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const [resource, setResource] = useState<CloudDesktopResource>({
    provider: "wuying",
    regionId: "",
    resourceId: "",
    profile: "",
  });
  const [binding, setBinding] = useState(false);
  const [tab, setTab] = useState("existing");
  const [purchaseProvider, setPurchaseProvider] = useState("ecs");
  const wuyingPurchase = useCloudPurchase({
    initialSpec: initialWuyingSpec,
    request: requestCloudDesktop,
    onPurchased: onChanged,
  });
  const ecsPurchase = useCloudPurchase({
    initialSpec: initialEcsSpec,
    request: requestCloudDesktop,
    onPurchased: onChanged,
  });
  const [templatePending, setTemplatePending] = useState(false);
  const pending =
    binding || wuyingPurchase.pending || ecsPurchase.pending || templatePending;
  const submitted = wuyingPurchase.submitted || ecsPurchase.submitted;
  const [error, setError] = useState("");
  const busy = useRef(false);
  async function bind() {
    if (busy.current) return;
    busy.current = true;
    setBinding(true);
    setError("");
    try {
      await requestCloudDesktop({ action: "bind", resource });
      onChanged();
      setOpen(false);
    } catch (cause) {
      setError(String(cause));
    } finally {
      busy.current = false;
      setBinding(false);
    }
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!pending) setOpen(value);
      }}
    >
      <Dialog.Trigger asChild>
        <SettingsAction>{t("settings.cloudDesktop.add")}</SettingsAction>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/30" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[70] max-h-[85vh] w-[min(620px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-xl border-[0.5px] border-border bg-popover p-6 text-popover-foreground outline-none"
          onEscapeKeyDown={(e) => {
            if (pending) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (pending) e.preventDefault();
          }}
        >
          <Dialog.Title className="text-base font-medium">
            {t("settings.cloudDesktop.add")}
          </Dialog.Title>
          <Dialog.Description className="text-[13px] text-muted-foreground">
            {t("settings.cloudDesktop.addDescription")}
          </Dialog.Description>
          <Tabs.Root value={tab} onValueChange={setTab}>
            <Tabs.List
              className="mb-5 flex gap-1"
              aria-label={t("settings.cloudDesktop.add")}
            >
              <Tabs.Trigger
                className={cloudTabClass}
                value="existing"
                disabled={pending || submitted}
              >
                {t("settings.cloudDesktop.bind")}
              </Tabs.Trigger>
              <Tabs.Trigger
                className={cloudTabClass}
                value="purchase"
                disabled={pending}
              >
                {t("settings.cloudDesktop.purchaseTitle")}
              </Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="existing" className="space-y-4 outline-none">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field name="provider">
                  <CloudSelect
                    value={resource.provider}
                    disabled={pending}
                    onChange={(e) =>
                      setResource({
                        ...resource,
                        provider: e.target
                          .value as CloudDesktopResource["provider"],
                      })
                    }
                  >
                    <option value="wuying">
                      {t("settings.cloudDesktop.wuying")}
                    </option>
                    <option value="ecs">Alibaba Cloud ECS</option>
                  </CloudSelect>
                </Field>
                {(["profile", "regionId", "resourceId"] as const).map(
                  (field) => (
                    <Field name={field} key={field}>
                      <input
                        className={inputClass}
                        value={resource[field]}
                        disabled={pending}
                        onChange={(e) =>
                          setResource({ ...resource, [field]: e.target.value })
                        }
                      />
                    </Field>
                  ),
                )}
              </div>
              {resource.provider === "ecs" && (
                <p className="text-[13px] text-muted-foreground">
                  {t("settings.cloudDesktop.ecsSupport")}
                </p>
              )}
              {error && (
                <p role="alert" className="text-[13px] text-destructive">
                  {error}
                </p>
              )}
              <SettingsAction
                disabled={
                  pending || Object.values(resource).some((value) => !value)
                }
                onClick={() => void bind()}
              >
                {t("settings.cloudDesktop.bind")}
              </SettingsAction>
            </Tabs.Content>
            <Tabs.Content value="purchase" className="outline-none">
              <div className="mb-4">
                <Field name="provider">
                  <CloudSelect
                    value={purchaseProvider}
                    disabled={pending || submitted}
                    onChange={(e) => setPurchaseProvider(e.target.value)}
                  >
                    <option value="ecs">Alibaba Cloud ECS</option>
                    <option value="wuying">
                      {t("settings.cloudDesktop.wuying")}
                    </option>
                  </CloudSelect>
                </Field>
              </div>
              {purchaseProvider === "ecs" ? (
                <PurchaseEcs
                  purchase={ecsPurchase}
                  onBusyChange={setTemplatePending}
                  preparing={templatePending}
                />
              ) : (
                <PurchaseWuying purchase={wuyingPurchase} />
              )}
            </Tabs.Content>
          </Tabs.Root>
          <div className="flex justify-end">
            <Dialog.Close asChild>
              <SettingsAction disabled={pending}>
                {t("settings.cloudDesktop.close")}
              </SettingsAction>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
