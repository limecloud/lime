import type { CloudDesktopResource } from "@limecloud/app-server-client";

export type CloudDesktopConnectionTransport = "direct" | "ecsTunnel";

export type CloudGuestInstallationRequest =
  | { action: "installationStatus"; resource: CloudDesktopResource }
  | { action: "showDesktopPassword"; resource: CloudDesktopResource }
  | {
      action: "installRuntime";
      resource: CloudDesktopResource;
      confirmation: string;
      trustArtifact: boolean;
      createDesktopUser: boolean;
    }
  | {
      action: "resumeInstallation";
      resource: CloudDesktopResource;
      operationId: string;
    };

export type CloudGuestInstallationStatus = {
  kind: "installation";
  available: boolean;
  exists: boolean;
  busy: boolean;
  operationId?: string;
  phase?:
    | "launching"
    | "uploading"
    | "saving"
    | "finishPending"
    | "complete"
    | "needsAttention"
    | "expired"
    | "failed";
  expiresAt?: number;
  diagnostic?: string;
  connectionSaved?: boolean;
};

export type CloudDesktopConnectionRequest =
  | CloudGuestInstallationRequest
  | ({
      action: "downloadArchive";
      resource: CloudDesktopResource;
    } & CloudArchiveSelection)
  | ({
      action: "restoreArchiveToCloud";
      resource: CloudDesktopResource;
    } & CloudArchiveRestoreSelection)
  | { action: "status" | "open" | "delete"; resource: CloudDesktopResource }
  | {
      action: "save";
      resource: CloudDesktopResource;
      endpoint: string;
      token: string;
    }
  | {
      action: "saveEcsTunnel";
      resource: CloudDesktopResource;
      token: string;
    };

export type CloudArchiveSelection = {
  sourceRoot: string;
  paths: string[];
  recipient: string;
  workSaved: boolean;
  includeCredentials: boolean;
};

export type CloudArchiveDownloadResult =
  | { kind: "archiveDownload"; canceled: true }
  | {
      kind: "archiveDownload";
      canceled: false;
      localPath: string;
      bytes: number;
      sha256: string;
    };

export type CloudArchiveRestoreSelection = {
  archivePath: string;
  identityFile: string;
  expectedSha256: string;
  folderName: string;
  confirmed: boolean;
};

export type CloudArchiveRestoreResult = {
  kind: "archiveRestore";
  destination: string;
  files: number;
  requiresApplicationValidation: true;
};

export type CloudDesktopConnectionMetadata = {
  available: boolean;
  exists: boolean;
  endpoint?: string;
  updatedAt?: string;
  transport?: CloudDesktopConnectionTransport;
};

export type CloudDesktopWindowContext = {
  kind: "cloud";
  resource: CloudDesktopResource;
  endpoint: string;
};

export type CloudDesktopWindowStatus = CloudDesktopWindowContext & {
  connected: boolean;
  generation: number;
};

export const CLOUD_DESKTOP_WINDOW_ARGUMENT = "--lime-cloud-desktop=";

export function readCloudDesktopWindowArgument(
  args: readonly string[],
): CloudDesktopWindowContext | undefined {
  const argument = args.find((value) =>
    value.startsWith(CLOUD_DESKTOP_WINDOW_ARGUMENT),
  );
  if (!argument) return undefined;
  const value = JSON.parse(
    decodeURIComponent(argument.slice(CLOUD_DESKTOP_WINDOW_ARGUMENT.length)),
  ) as CloudDesktopWindowContext;
  if (
    value.kind !== "cloud" ||
    typeof value.endpoint !== "string" ||
    !value.resource
  )
    throw new Error("invalid cloud desktop window context");
  return value;
}
