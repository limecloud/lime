import { createHash, randomUUID } from "node:crypto";
import type {
  CloudDesktopResource,
  CloudDesktopResponse,
} from "@limecloud/app-server-client";
import type {
  CloudDesktopConnectionRequest,
  CloudModelConnectionStatus,
} from "../src/lib/desktop-host/cloudDesktopConnection";
import {
  ElectronEncryptedStateFile,
  type CloudSessionCredential,
  type SafeStorageLike,
} from "./secureCredentialStore";
import type { CloudDesktopRequest } from "./cloudDesktopTaskTunnel";

type Request = Extract<
  CloudDesktopConnectionRequest,
  {
    action:
      | "shareModelConnection"
      | "resumeModelConnection"
      | "modelConnectionStatus";
  }
>;
type Intent = {
  version: 1;
  operationId: string;
  target: string;
  providerId: string;
  keyId: string;
  phase: Exclude<CloudModelConnectionStatus["phase"], "idle">;
  ciphertext?: string;
};
const phases = new Set([
  "preparing",
  "sealing",
  "ready",
  "unknown",
  "complete",
  "expired",
]);
const validId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 256 &&
  ![...value].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const unavailable = () => new Error("CLOUD_MODEL_CONNECTION_FAILED");

/** Coordinates one explicit delivery; authority stays with the two Provider owners. */
export class CloudModelConnections {
  constructor(
    readonly safeStorage: SafeStorageLike,
    readonly local: CloudDesktopRequest,
  ) {}

  static async blocksConnectionChange(
    root: string,
    safeStorage: SafeStorageLike,
  ): Promise<boolean> {
    const intent = await readIntent(
      new ElectronEncryptedStateFile(root, "model-connection.v1", safeStorage),
    );
    return !!intent && !["complete", "expired"].includes(intent.phase);
  }

  async invoke(
    root: string,
    resource: CloudDesktopResource,
    credential: CloudSessionCredential | null,
    request: Request,
    remote?: CloudDesktopRequest,
  ): Promise<CloudModelConnectionStatus> {
    try {
      const file = new ElectronEncryptedStateFile(
        root,
        "model-connection.v1",
        this.safeStorage,
      );
      let intent = await readIntent(file);
      if (request.action === "modelConnectionStatus") return status(intent);
      if (!credential || !remote) throw unavailable();
      const target = createHash("sha256")
        .update(
          JSON.stringify([
            resource,
            credential.tenantId,
            credential.endpoint,
            credential.transport ?? "direct",
            credential.token,
          ]),
        )
        .digest("hex");
      if (request.action === "shareModelConnection") {
        if (
          !validId(request.providerId) ||
          !validId(request.keyId) ||
          request.confirmation !==
            `share-model:${resource.regionId}:${resource.resourceId}:${request.providerId}:${request.keyId}`
        )
          throw unavailable();
        if (intent && !["complete", "expired"].includes(intent.phase))
          throw unavailable();
        intent = {
          version: 1,
          operationId: randomUUID(),
          target,
          providerId: request.providerId,
          keyId: request.keyId,
          phase: "preparing",
        };
        // Durable intent precedes even destination preparation. Reads never create it.
        await file.write(intent);
      } else if (
        !intent ||
        intent.operationId !== request.operationId ||
        intent.target !== target
      ) {
        throw unavailable();
      }
      if (!intent || intent.target !== target) throw unavailable();
      const id = intent.operationId;
      let response: CloudDesktopResponse = await remote({
        action: "readModelConnection",
        operationId: id,
      });
      let state = response.data as Record<string, unknown>;
      if (state.operationId !== id) throw unavailable();
      if (state.phase === "complete" || state.phase === "expired") {
        intent.phase = state.phase;
        delete intent.ciphertext;
        await file.write(intent);
        return status(intent);
      }
      if (intent.phase === "complete" || intent.phase === "expired")
        throw unavailable();
      if (state.phase === "notFound" || state.phase === "preparing") {
        if (intent.phase !== "preparing" || intent.ciphertext)
          throw unavailable();
        response = await remote({
          action: "prepareModelConnection",
          operationId: id,
        });
        state = response.data as Record<string, unknown>;
      }
      if (
        state.operationId !== id ||
        !["prepared", "receiving"].includes(String(state.phase))
      )
        throw unavailable();
      if (!intent.ciphertext) {
        if (
          state.phase !== "prepared" ||
          typeof state.recipient !== "string" ||
          !/^age1[a-z0-9]{58}$/u.test(state.recipient) ||
          typeof state.expiresAt !== "number" ||
          !Number.isSafeInteger(state.expiresAt) ||
          state.expiresAt <= Date.now() / 1000 ||
          state.expiresAt > Date.now() / 1000 + 600
        )
          throw unavailable();
        intent.phase = "sealing";
        await file.write(intent);
        const sealed = (
          await this.local({
            action: "sealModelConnection",
            operationId: id,
            recipient: state.recipient,
            expiresAt: state.expiresAt,
            providerId: intent.providerId,
            keyId: intent.keyId,
          })
        ).data as Record<string, unknown>;
        if (
          sealed.operationId !== id ||
          typeof sealed.ciphertext !== "string" ||
          sealed.ciphertext.length < 1 ||
          sealed.ciphertext.length > 100_000 ||
          !/^[A-Za-z0-9+/]+={0,2}$/u.test(sealed.ciphertext)
        )
          throw unavailable();
        intent.ciphertext = sealed.ciphertext;
        intent.phase = "ready";
        await file.write(intent);
      }
      intent.phase = "unknown";
      await file.write(intent);
      // An explicit resume may resend exactly this ciphertext to its idempotent receiver.
      const applied = (
        await remote({
          action: "applyModelConnection",
          operationId: id,
          ciphertext: intent.ciphertext,
        })
      ).data as Record<string, unknown>;
      if (applied.operationId !== id || applied.phase !== "complete")
        throw unavailable();
      intent.phase = "complete";
      delete intent.ciphertext;
      await file.write(intent);
      return status(intent);
    } catch {
      // No remote error, endpoint or payload is returned to Renderer.
      throw unavailable();
    }
  }
}

function status(intent: Intent | null): CloudModelConnectionStatus {
  return intent
    ? {
        kind: "modelConnection",
        phase: intent.phase,
        operationId: intent.operationId,
        providerId: intent.providerId,
        keyId: intent.keyId,
      }
    : { kind: "modelConnection", phase: "idle" };
}

async function readIntent(
  file: ElectronEncryptedStateFile,
): Promise<Intent | null> {
  const value = (await file.read()) as Intent | null;
  if (value === null) return null;
  if (
    value.version !== 1 ||
    !uuid.test(value.operationId) ||
    !/^[a-f0-9]{64}$/u.test(value.target) ||
    !validId(value.providerId) ||
    !validId(value.keyId) ||
    !phases.has(value.phase) ||
    (value.ciphertext !== undefined &&
      (typeof value.ciphertext !== "string" ||
        value.ciphertext.length > 100_000))
  )
    throw unavailable();
  return value;
}
