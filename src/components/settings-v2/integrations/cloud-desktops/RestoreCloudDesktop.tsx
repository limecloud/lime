import { useCallback, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import type {
  CloudDesktopResource,
  EcsDesktopSpec,
} from "@limecloud/app-server-client";
import { requestCloudDesktop } from "@/lib/api/cloud";
import { SettingsAction } from "../../SettingsPrimitives";
import { PurchaseEcs } from "./PurchaseEcs";
import { initialEcsSpec } from "./purchaseSpecs";
import { useCloudPurchase } from "./useCloudPurchase";
import { cloudPurchasedResource } from "./cloudPurchasedResource";
import type { EcsSystemImage } from "./EcsSystemImages";
import { CloudTaskConnection } from "./CloudTaskConnection";

export function RestoreCloudDesktop({
  onChanged,
  isRunning,
}: {
  onChanged: () => void;
  isRunning: (resource: CloudDesktopResource) => boolean;
}) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [image, setImage] = useState<EcsSystemImage>();
  const [provisioned, setProvisioned] = useState<CloudDesktopResource>();
  const resolveSpec = useCallback(
    (spec: EcsDesktopSpec): EcsDesktopSpec => {
      if (!image?.ready)
        throw new Error("A verified private system image is required");
      return {
        ...spec,
        imageId: image.imageId,
        systemDiskGib: Math.max(spec.systemDiskGib, image.systemDiskGiB),
      };
    },
    [image],
  );
  const purchase = useCloudPurchase({
    initialSpec: initialEcsSpec,
    request: requestCloudDesktop,
    resolveSpec,
    onPurchased: (receipt, context) => {
      const resource = cloudPurchasedResource(receipt, context);
      if (resource) setProvisioned(resource);
      onChanged();
    },
  });
  const pending = preparing || purchase.pending;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!pending) setOpen(value);
      }}
    >
      <Dialog.Trigger asChild>
        <SettingsAction>
          {t("settings.cloudDesktop.restoreDesktop")}
        </SettingsAction>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/30" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[70] max-h-[85vh] w-[min(620px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-xl border-[0.5px] border-border bg-popover p-6 text-popover-foreground outline-none"
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (pending) event.preventDefault();
          }}
        >
          <Dialog.Title className="text-base font-medium">
            {t("settings.cloudDesktop.restoreDesktop")}
          </Dialog.Title>
          <Dialog.Description className="text-[13px] text-muted-foreground">
            {t("settings.cloudDesktop.restoreDesktopHelp")}
          </Dialog.Description>
          {provisioned ? (
            <div className="space-y-3 text-[13px]">
              <p role="status">
                {t("settings.cloudDesktop.restoredDesktopReady")}
              </p>
              {isRunning(provisioned) ? (
                <CloudTaskConnection resource={provisioned} running />
              ) : (
                <p role="status">
                  {t("settings.cloudDesktop.status.Starting")}
                </p>
              )}
            </div>
          ) : (
            <PurchaseEcs
              purchase={purchase}
              onBusyChange={setPreparing}
              preparing={preparing}
              restoring
              systemImage={image}
              onSystemImage={setImage}
            />
          )}
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
