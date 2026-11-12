import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { CloudDesktopResource } from "@limecloud/app-server-client";
import type {
  CloudGuestInstallationRequest,
  CloudGuestInstallationStatus,
} from "../src/lib/desktop-host/cloudDesktopConnection";
import {
  ElectronEncryptedStateFile,
  type SafeStorageLike,
} from "./secureCredentialStore";
import {
  openCloudGuestArtifact,
  validateArtifact,
  selectCloudGuestSource,
  validateDownloadUrl,
  type CloudGuestArtifact,
  type CloudGuestSource,
} from "./cloudGuestArtifact";
import {
  requestCloudGuestUpload,
  type CloudGuestUpload,
} from "./cloudGuestUpload";
import type { CloudDesktopRequest } from "./cloudDesktopTaskTunnel";
import { openCloudGuestUploadTunnel } from "./cloudGuestUploadTunnel";
import { waitForCloudGuestRequest } from "./cloudGuestRequest";

type Phase = NonNullable<CloudGuestInstallationStatus["phase"]>;
type RecordState = {
  version: 1;
  resource: CloudDesktopResource;
  operationId: string;
  artifactPath?: string;
  artifact?: CloudGuestArtifact;
  downloadUrl?: string;
  reconnect?: true;
  capability: string;
  createdAt: number;
  phase: Phase;
  uploadAttempted: boolean;
  credentialsSaved: boolean;
  upload?: CloudGuestUpload;
  viewerPassword?: string;
  diagnostic?: string;
  preparation?: {
    operationId: string;
    submitted: boolean;
    ready: boolean;
    launchStartedAt?: number;
  };
};
const phases: Phase[] = [
  "waitingForAgent",
  "preparing",
  "launching",
  "uploading",
  "saving",
  "finishPending",
  "complete",
  "needsAttention",
  "expired",
  "failed",
];
const terminal = (phase: Phase) =>
  ["complete", "expired", "failed"].includes(phase);
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
const sameResource = (
  left: CloudDesktopResource | undefined,
  right: CloudDesktopResource,
) =>
  Boolean(
    left &&
    (["provider", "profile", "regionId", "resourceId"] as const).every(
      (key) => left[key] === right[key],
    ),
  );

/** Main-only orchestration. Status reads never launch, upload, or resume a mutation. */
export class CloudGuestInstallations {
  readonly #jobs = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();
  #stopping = false;
  constructor(
    readonly root: string,
    readonly safeStorage: SafeStorageLike,
    readonly request: CloudDesktopRequest,
    readonly selectArtifact: () => Promise<string | undefined>,
    readonly saveCredential: (
      resource: CloudDesktopResource,
      token: string,
      replace?: boolean,
    ) => Promise<void>,
    readonly transport = requestCloudGuestUpload,
    readonly pollMs = 2000,
    readonly showDesktopPassword?: (password: string) => Promise<void>,
    readonly selectRelease?: () => Promise<CloudGuestSource>,
  ) {}

  #file(key: string) {
    return new ElectronEncryptedStateFile(
      path.join(this.root, "cloud-desktop-connections", key),
      "runtime-installation.v1",
      this.safeStorage,
    );
  }

  async #read(
    key: string,
    resource: CloudDesktopResource,
  ): Promise<RecordState | null> {
    const value = (await this.#file(key).read()) as RecordState | null;
    if (!value) return null;
    if (
      value.version !== 1 ||
      !sameResource(value.resource, resource) ||
      !uuid(value.operationId) ||
      !phases.includes(value.phase) ||
      (value.reconnect === true
        ? value.artifactPath !== undefined ||
          value.artifact !== undefined ||
          value.downloadUrl !== undefined
        : value.reconnect !== undefined ||
          (value.artifactPath === undefined
            ? value.downloadUrl === undefined
            : typeof value.artifactPath !== "string" ||
              !path.isAbsolute(value.artifactPath))) ||
      !/^[a-f0-9]{64}$/u.test(value.capability) ||
      !Number.isSafeInteger(value.createdAt) ||
      typeof value.uploadAttempted !== "boolean" ||
      typeof value.credentialsSaved !== "boolean"
    )
      throw new Error("CLOUD_INSTALL_STATE_INVALID");
    if (!value.reconnect) validateArtifact(value.artifact);
    if (value.downloadUrl !== undefined) validateDownloadUrl(value.downloadUrl);
    if (
      value.preparation !== undefined &&
      (!value.preparation ||
        typeof value.preparation !== "object" ||
        value.reconnect ||
        !uuid(value.preparation.operationId) ||
        value.preparation.operationId === value.operationId ||
        typeof value.preparation.submitted !== "boolean" ||
        typeof value.preparation.ready !== "boolean" ||
        (value.preparation.ready && !value.preparation.submitted) ||
        (value.preparation.launchStartedAt !== undefined &&
          (!value.preparation.ready ||
            !Number.isSafeInteger(value.preparation.launchStartedAt) ||
            value.preparation.launchStartedAt < value.createdAt)))
    )
      throw new Error("CLOUD_INSTALL_STATE_INVALID");
    if (
      value.upload &&
      (value.upload.operationId !== value.operationId ||
        typeof value.upload.certificate !== "string" ||
        !Number.isSafeInteger(value.upload.expiresAt))
    )
      throw new Error("CLOUD_INSTALL_STATE_INVALID");
    return value;
  }

  async blocksConnectionChange(
    key: string,
    resource: CloudDesktopResource,
  ): Promise<boolean> {
    const state = await this.#read(key, resource);
    return this.#jobs.has(key) || Boolean(state && !terminal(state.phase));
  }

  async blocksConnectionOpen(
    key: string,
    resource: CloudDesktopResource,
  ): Promise<boolean> {
    const state = await this.#read(key, resource);
    return Boolean(
      state?.reconnect && !state.credentialsSaved && !terminal(state.phase),
    );
  }

  async status(
    key: string,
    resource: CloudDesktopResource,
  ): Promise<CloudGuestInstallationStatus> {
    const available = this.#file(key).available;
    if (!available)
      return { kind: "installation", available, exists: false, busy: false };
    const busy = this.#jobs.has(key);
    const state = await this.#read(key, resource);
    return {
      kind: "installation",
      available,
      exists: Boolean(state),
      // Keep polling if the disk snapshot predates a job that completed during read.
      busy: busy || this.#jobs.has(key),
      ...(state
        ? {
            operationId: state.operationId,
            mode: state.reconnect ? "reconnect" : "install",
            phase: state.phase,
            createdAt: state.createdAt,
            connectionSaved: state.credentialsSaved,
            expiresAt: state.upload?.expiresAt,
            ...(state.diagnostic ? { diagnostic: state.diagnostic } : {}),
          }
        : {}),
    };
  }

  async invoke(
    key: string,
    resource: CloudDesktopResource,
    request: CloudGuestInstallationRequest,
  ): Promise<CloudGuestInstallationStatus> {
    if (resource.provider !== "ecs" || this.#stopping)
      throw new Error("CLOUD_INSTALL_UNAVAILABLE");
    if (request.action === "installationStatus")
      return this.status(key, resource);
    this.#file(key).assertAvailable();
    let state = await this.#read(key, resource);
    if (request.action === "showDesktopPassword") {
      if (
        !state?.credentialsSaved ||
        !this.showDesktopPassword ||
        !/^[A-Za-z0-9_-]{8}$/u.test(state.viewerPassword ?? "")
      )
        throw new Error("CLOUD_INSTALL_STATE_INVALID");
      await this.showDesktopPassword(state.viewerPassword!);
      return this.status(key, resource);
    }
    if (
      request.action === "installRuntime" ||
      request.action === "reconnectRuntime"
    ) {
      const reconnect = request.action === "reconnectRuntime";
      if (
        request.confirmation !==
          `${request.action}:${resource.regionId}:${resource.resourceId}` ||
        (reconnect
          ? request.workSaved !== true
          : !["release", "file"].includes(request.source) ||
            request.trustArtifact !== true ||
            request.createDesktopUser !== true ||
            request.installSystemPackages !== true)
      )
        throw new Error("CLOUD_INSTALL_CONSENT_REQUIRED");
      if (this.#jobs.has(key)) return this.status(key, resource);
      if (state && !terminal(state.phase))
        throw new Error("CLOUD_INSTALL_UNRESOLVED");
      let artifact: CloudGuestSource | undefined;
      if (!reconnect) {
        if (request.source === "release") {
          if (!this.selectRelease)
            throw new Error("CLOUD_INSTALL_RELEASE_UNAVAILABLE");
          artifact = await this.selectRelease();
          validateArtifact(artifact.artifact);
          validateDownloadUrl(artifact.downloadUrl);
        } else {
          const selected = await this.selectArtifact();
          if (!selected) return this.status(key, resource);
          artifact = await selectCloudGuestSource(selected);
        }
      }
      state = {
        version: 1,
        resource,
        operationId: randomUUID(),
        ...artifact,
        ...(reconnect ? { reconnect: true as const } : {}),
        ...(!reconnect
          ? {
              preparation: {
                operationId: randomUUID(),
                submitted: false,
                ready: false,
              },
            }
          : {}),
        capability: randomBytes(32).toString("hex"),
        createdAt: Date.now(),
        phase: reconnect ? "launching" : "preparing",
        uploadAttempted: false,
        credentialsSaved: false,
      };
      // Durable recovery identity precedes the first supplier-side submission.
      await this.#file(key).write(state);
      this.#start(key, state, true);
    } else {
      if (!state || request.operationId !== state.operationId)
        throw new Error("CLOUD_INSTALL_STATE_INVALID");
      if (this.#jobs.has(key)) return this.status(key, resource);
      if (!terminal(state.phase)) this.#start(key, state, false);
    }
    return this.status(key, resource);
  }

  #start(key: string, state: RecordState, submit: boolean): void {
    const controller = new AbortController();
    const done = this.#run(key, state, submit, controller.signal)
      .catch(async () => {
        state.phase = "needsAttention";
        state.diagnostic = "CLOUD_INSTALL_RECOVERY_REQUIRED";
        await this.#file(key)
          .write(state)
          .catch(() => undefined);
      })
      .finally(() => {
        this.#jobs.delete(key);
      });
    this.#jobs.set(key, { controller, done });
  }

  async #persist(
    key: string,
    state: RecordState,
    phase: Phase,
    diagnostic?: string,
  ) {
    state.phase = phase;
    state.diagnostic = diagnostic;
    await this.#file(key).write(state);
  }

  #request(params: Parameters<CloudDesktopRequest>[0], signal: AbortSignal) {
    signal.throwIfAborted();
    return waitForCloudGuestRequest(this.request(params), signal);
  }

  async #run(
    key: string,
    state: RecordState,
    submit: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      let submitRuntime = submit;
      if (state.preparation) {
        if (!(await this.#prepareDesktop(key, state, signal))) return;
        submitRuntime = state.preparation.launchStartedAt === undefined;
        if (submitRuntime) {
          // Persist launch intent before sending. Recovery only queries this ID.
          state.preparation.launchStartedAt = Date.now();
          await this.#persist(key, state, "launching");
          signal.throwIfAborted();
        }
      }
      const launchStartedAt =
        state.preparation?.launchStartedAt ?? state.createdAt;
      const common = {
        resource: state.resource,
        operationId: state.operationId,
        capabilitySha256: createHash("sha256")
          .update(state.capability)
          .digest("hex"),
      };
      const request = state.reconnect
        ? {
            ...common,
            action: "reconnectEcsRuntime" as const,
            confirmation: `reconnectRuntime:${state.resource.regionId}:${state.resource.resourceId}`,
            workSaved: true,
          }
        : {
            ...common,
            action: "startEcsRuntimeInstallation" as const,
            ...state.artifact!,
            confirmation: `installRuntime:${state.resource.regionId}:${state.resource.resourceId}`,
            createDesktopUser: true,
          };
      let receipt = (
        submitRuntime ? (await this.#request(request, signal)).data : undefined
      ) as Record<string, unknown> | undefined;
      while (!state.upload) {
        signal.throwIfAborted();
        if (Date.now() - launchStartedAt > 30 * 60_000) {
          await this.#persist(key, state, "expired", "CLOUD_INSTALL_EXPIRED");
          return;
        }
        receipt ??= (
          await this.#request(
            { action: "readOperation", operationId: state.operationId },
            signal,
          )
        ).data as Record<string, unknown>;
        this.#validateReceipt(state, receipt);
        if (
          ["notSubmitted", "runtimeLaunchFailed"].includes(
            String(receipt.outcome),
          )
        ) {
          await this.#persist(
            key,
            state,
            "failed",
            receipt.failureCode === "dependenciesNotReady"
              ? "CLOUD_INSTALL_DEPENDENCIES_REQUIRED"
              : "CLOUD_INSTALL_LAUNCH_FAILED",
          );
          return;
        }
        if (receipt.outcome === "runtimeUploadReady") {
          const upload = receipt.upload as CloudGuestUpload;
          if (
            !upload ||
            upload.operationId !== state.operationId ||
            typeof upload.certificate !== "string" ||
            upload.expiresAt !== receipt.expiresAt ||
            !Number.isSafeInteger(upload.expiresAt) ||
            upload.expiresAt * 1000 > launchStartedAt + 31 * 60_000
          )
            throw new Error("CLOUD_INSTALL_STATE_INVALID");
          state.upload = {
            operationId: upload.operationId,
            certificate: upload.certificate,
            expiresAt: upload.expiresAt,
          };
          await this.#persist(key, state, "uploading");
          break;
        }
        await delay(this.pollMs, undefined, { signal });
        receipt = undefined;
      }
      const tunnel = await openCloudGuestUploadTunnel(
        this.request,
        state.resource,
        signal,
      );
      try {
        await this.#uploadRuntime(
          key,
          state,
          { ...state.upload!, endpoint: tunnel.endpoint },
          signal,
        );
      } finally {
        await tunnel.close();
      }
    } catch (error) {
      if (signal.aborted && terminal(state.phase)) return;
      await this.#persist(
        key,
        state,
        state.upload && state.upload.expiresAt * 1000 <= Date.now()
          ? "expired"
          : "needsAttention",
        error instanceof Error &&
          error.message === "CLOUD_INSTALL_SECURITY_GROUP_DENIED"
          ? "CLOUD_INSTALL_SECURITY_GROUP_DENIED"
          : "CLOUD_INSTALL_RECOVERY_REQUIRED",
      );
    }
  }

  async #uploadRuntime(
    key: string,
    state: RecordState,
    target: CloudGuestUpload & { endpoint: string },
    signal: AbortSignal,
  ): Promise<void> {
    while (true) {
      signal.throwIfAborted();
      if (target.expiresAt * 1000 <= Date.now()) {
        await this.#persist(key, state, "expired", "CLOUD_INSTALL_EXPIRED");
        return;
      }
      // A lost finish response is harmless after credentials are durable. Never
      // retrieve or overwrite credentials again during finish-only recovery.
      if (state.credentialsSaved) {
        await this.#persist(key, state, "finishPending");
        const result = await this.transport(
          target,
          state.capability,
          "/finish",
          signal,
        );
        if (result.phase !== "finished")
          throw new Error("CLOUD_INSTALL_STATE_INVALID");
        await this.#persist(key, state, "complete");
        return;
      }
      const status = await this.transport(
        target,
        state.capability,
        "/status",
        signal,
      );
      if (
        status.operationId !== state.operationId ||
        status.expiresAt !== target.expiresAt
      )
        throw new Error("CLOUD_INSTALL_STATE_INVALID");
      if (status.phase === "waiting") {
        if (state.uploadAttempted) {
          await this.#persist(
            key,
            state,
            "needsAttention",
            "CLOUD_INSTALL_UPLOAD_UNKNOWN",
          );
          return;
        }
        if (state.reconnect) {
          state.uploadAttempted = true;
          await this.#persist(key, state, "uploading");
          await this.transport(target, state.capability, "/reconnect", signal);
          continue;
        }
        if (state.downloadUrl) {
          state.uploadAttempted = true;
          await this.#persist(key, state, "uploading");
          await this.transport(target, state.capability, "/download", signal, {
            downloadUrl: state.downloadUrl,
          });
          continue;
        }
        const artifact = await openCloudGuestArtifact(
          state.artifactPath!,
          state.artifact,
        );
        try {
          state.uploadAttempted = true;
          await this.#persist(key, state, "uploading");
          await this.transport(target, state.capability, "/runtime", signal, {
            file: artifact.file,
            bytes: artifact.artifact.archiveBytes,
          });
        } finally {
          await artifact.file.close();
        }
        continue;
      }
      if (["receiving", "installing"].includes(String(status.phase))) {
        await delay(this.pollMs, undefined, { signal });
        continue;
      }
      if (status.phase === "failed") {
        await this.#persist(key, state, "failed", "CLOUD_INSTALL_FAILED");
        return;
      }
      if (status.phase !== "installed")
        throw new Error("CLOUD_INSTALL_STATE_INVALID");
      await this.#persist(key, state, "saving");
      const credential = await this.transport(
        target,
        state.capability,
        "/credentials",
        signal,
      );
      if (
        credential.operationId !== state.operationId ||
        typeof credential.token !== "string" ||
        !/^[A-Za-z0-9_-]{32,256}$/u.test(credential.token) ||
        typeof credential.viewerPassword !== "string" ||
        !/^[A-Za-z0-9_-]{8}$/u.test(credential.viewerPassword)
      )
        throw new Error("CLOUD_INSTALL_STATE_INVALID");
      // Viewer secret remains in this encrypted private record, never metadata.
      state.viewerPassword = credential.viewerPassword;
      if (state.reconnect)
        await this.saveCredential(state.resource, credential.token, true);
      else await this.saveCredential(state.resource, credential.token);
      state.credentialsSaved = true;
      await this.#persist(key, state, "finishPending");
    }
  }

  async #prepareDesktop(
    key: string,
    state: RecordState,
    signal: AbortSignal,
  ): Promise<boolean> {
    const preparation = state.preparation!;
    if (preparation.ready) return true;
    await this.#persist(key, state, "preparing");
    let receipt: Record<string, unknown> | undefined;
    const prepare = async () =>
      (
        await this.#request(
          {
            action: "prepareEcsDesktop",
            resource: state.resource,
            operationId: preparation.operationId,
            confirmation: `prepareEcsDesktop:${state.resource.regionId}:${state.resource.resourceId}`,
            installSystemPackages: true,
          },
          signal,
        )
      ).data as Record<string, unknown>;
    if (!preparation.submitted) {
      preparation.submitted = true;
      await this.#persist(key, state, "preparing");
      signal.throwIfAborted();
      receipt = await prepare();
    }
    while (true) {
      signal.throwIfAborted();
      if (Date.now() - state.createdAt > 31 * 60_000) {
        await this.#persist(key, state, "expired", "CLOUD_INSTALL_EXPIRED");
        return false;
      }
      receipt ??= (
        await this.#request(
          { action: "readOperation", operationId: preparation.operationId },
          signal,
        )
      ).data as Record<string, unknown>;
      const request = receipt?.request as Record<string, unknown> | undefined;
      if (
        receipt?.operationId !== preparation.operationId ||
        request?.action !== "prepareEcsDesktop" ||
        request.installSystemPackages !== true ||
        !sameResource(
          request.resource as CloudDesktopResource,
          state.resource,
        ) ||
        ![
          "unknown",
          "accepted",
          "preparing",
          "waitingForAgent",
          "dependenciesReady",
          "notSubmitted",
          "preparationFailed",
        ].includes(String(receipt.outcome)) ||
        receipt.packagesPrepared !== (receipt.outcome === "dependenciesReady")
      )
        throw new Error("CLOUD_INSTALL_STATE_INVALID");
      if (receipt.outcome === "waitingForAgent") {
        if (
          receipt.submitted !== false ||
          receipt.requiresInspection !== false ||
          typeof receipt.agentReady !== "boolean" ||
          receipt.invokeId != null ||
          receipt.commandId != null
        )
          throw new Error("CLOUD_INSTALL_STATE_INVALID");
        await this.#persist(key, state, "waitingForAgent");
        if (receipt.agentReady) {
          // Only a known unsubmitted intent can continue. Unknown submissions stay read-only.
          receipt = await prepare();
          continue;
        }
      } else if (state.phase === "waitingForAgent") {
        await this.#persist(key, state, "preparing");
      }
      if (
        ["notSubmitted", "preparationFailed"].includes(String(receipt.outcome))
      ) {
        await this.#persist(
          key,
          state,
          "failed",
          "CLOUD_INSTALL_PREPARATION_FAILED",
        );
        return false;
      }
      if (receipt.outcome === "dependenciesReady") {
        preparation.ready = true;
        await this.#persist(key, state, "launching");
        return true;
      }
      await delay(this.pollMs, undefined, { signal });
      receipt = undefined;
    }
  }

  #validateReceipt(state: RecordState, receipt: Record<string, unknown>) {
    const request = receipt?.request as Record<string, unknown> | undefined;
    if (
      receipt?.operationId !== state.operationId ||
      request?.operationId !== state.operationId ||
      request.action !==
        (state.reconnect
          ? "reconnectEcsRuntime"
          : "startEcsRuntimeInstallation") ||
      !sameResource(request.resource as CloudDesktopResource, state.resource) ||
      request.capabilitySha256 !==
        createHash("sha256").update(state.capability).digest("hex") ||
      (state.reconnect
        ? request.workSaved !== true || request.artifact !== undefined
        : JSON.stringify(validateArtifact(request.artifact)) !==
          JSON.stringify(state.artifact)) ||
      ![
        "unknown",
        "accepted",
        "runtimeStarting",
        "runtimeUploadReady",
        "notSubmitted",
        "runtimeLaunchFailed",
      ].includes(String(receipt.outcome))
    )
      throw new Error("CLOUD_INSTALL_STATE_INVALID");
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    const jobs = [...this.#jobs.values()];
    for (const job of jobs) job.controller.abort();
    await Promise.allSettled(jobs.map((job) => job.done));
  }
}
