import { describe, expect, it, vi } from "vitest";
import process from "node:process";
import {
  createHarness,
  mount,
  clipboardWriteTextMock,
  shellOpenPathMock,
  shellShowItemInFolderMock,
} from "./browserTabHost.testHarness";

describe("ElectronBrowserTabHost", () => {
  it("uses saved website allows only while the native tab is owned by the user", async () => {
    const harness = createHarness();
    const mounted = (await mount(harness)) as { viewId: string };
    const handler =
      harness.embeddedHost.setSitePermissionDecisionHandler.mock.calls[0][0]!;
    expect(handler.canUseSavedPermissions(mounted.viewId)).toBe(true);
    expect(handler.canUseSavedPermissions("foreign-view")).toBe(false);
    await harness.host.executeTool({
      arguments: {
        pageRevision: 0,
        tabId: "tab-1",
        title: "Example",
        url: "https://example.com/",
      },
      callId: "claim-site-permission",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "claimTab",
      turnId: "turn-1",
    });
    expect(handler.canUseSavedPermissions(mounted.viewId)).toBe(false);
  });

  it("keeps Renderer and Agent actions on the same native WebContents", async () => {
    const harness = createHarness();
    const mounted = (await mount(harness)) as {
      viewId: string;
      webContentsId: number;
    };

    await harness.host.executeTool({
      arguments: {
        pageRevision: 0,
        tabId: "tab-1",
        title: "Example",
        url: "https://example.com/",
      },
      callId: "claim-1",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "claimTab",
      turnId: "turn-1",
    });
    const observed = await harness.host.executeTool({
      arguments: { tabId: "tab-1" },
      callId: "observe-1",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "observe",
      turnId: "turn-1",
    });

    expect(observed.state?.webContentsId).toBe(mounted.webContentsId);
    expect(observed.data).toMatchObject({
      pageRevision: 0,
      snapshotId: expect.any(String),
    });
    expect(observed.state).toMatchObject({
      browserSessionId: "browser-session-1",
      ownerWebContentsId: 41,
      tabId: "tab-1",
      threadId: "thread-1",
    });
    const native = harness.views.get(mounted.viewId);
    expect(native?.webContents.debugger.attach).toHaveBeenCalledWith("1.3");
    expect(native?.webContents.debugger.sendCommand).toHaveBeenCalledWith(
      "Accessibility.getFullAXTree",
    );
  });

  it("preserves the current URL when an existing user tab is remounted", async () => {
    const harness = createHarness();
    const first = (await mount(harness)) as { viewId: string; url: string };
    await harness.host.invoke(harness.window as never, "browser_tab_navigate", {
      tabId: "tab-1",
      url: "https://example.com/navigated",
    });

    await mount(harness, { url: "https://example.com/initial" });

    expect(harness.views.get(first.viewId)?.webContents.getURL()).toBe(
      "https://example.com/navigated",
    );
    const mountCalls = harness.embeddedHost.invoke.mock.calls.filter(
      ([, command]) => command === "embedded_browser_view_mount",
    );
    expect(mountCalls).toHaveLength(2);
    expect((mountCalls[1]?.[2] as { url?: unknown }).url).toBeUndefined();
  });

  it("preflights a sensitive click and executes it once after approval", async () => {
    const harness = createHarness();
    const mounted = (await mount(harness)) as { viewId: string };
    await harness.host.executeTool({
      arguments: {
        pageRevision: 0,
        tabId: "tab-1",
        title: "Example",
        url: "https://example.com/",
      },
      callId: "claim-1",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "claimTab",
      turnId: "turn-1",
    });
    const observed = await harness.host.executeTool({
      arguments: { tabId: "tab-1" },
      callId: "observe-1",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "observe",
      turnId: "turn-1",
    });
    const snapshotId = String(
      (observed.data as { snapshotId?: string }).snapshotId,
    );
    const native = harness.views.get(mounted.viewId);
    if (!native) {
      throw new Error("missing Browser test view");
    }
    native.webContents.nodeAttributes = ["aria-label", "Delete account"];
    const argumentsValue = {
      backendNodeId: 11,
      snapshotId,
      tabId: "tab-1",
    };

    const preflight = await harness.host.executeTool({
      arguments: argumentsValue,
      callId: "click-sensitive-1",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "click",
      turnId: "turn-1",
    });

    expect(preflight).toMatchObject({
      status: "approval_required",
      approval: {
        actionKind: "click",
        approvalToken: expect.any(String),
        backendNodeId: 11,
        riskClass: "high_impact_click",
        snapshotId,
        tabId: "tab-1",
        webContentsId: native.webContents.id,
      },
      state: { controlOwner: "agent", pageRevision: 0 },
    });
    expect(
      native.webContents.debugger.sendCommand.mock.calls.some(
        ([method]) => method === "Input.dispatchMouseEvent",
      ),
    ).toBe(false);

    const approved = await harness.host.executeTool({
      approvalToken: preflight.approval?.approvalToken,
      arguments: argumentsValue,
      callId: "click-sensitive-1",
      ownerWebContentsId: 41,
      phase: "approvedExecute",
      threadId: "thread-1",
      tool: "click",
      turnId: "turn-1",
    });

    expect(approved).toMatchObject({
      status: "completed",
      state: { controlOwner: "agent", pageRevision: 1 },
    });
    expect(
      native.webContents.debugger.sendCommand.mock.calls.filter(
        ([method]) => method === "Input.dispatchMouseEvent",
      ),
    ).toHaveLength(2);
    await expect(
      harness.host.executeTool({
        approvalToken: preflight.approval?.approvalToken,
        arguments: argumentsValue,
        callId: "click-sensitive-1",
        ownerWebContentsId: 41,
        phase: "approvedExecute",
        threadId: "thread-1",
        tool: "click",
        turnId: "turn-1",
      }),
    ).rejects.toThrow("approval token is stale or invalid");

    const observedAgain = await harness.host.executeTool({
      arguments: { tabId: "tab-1" },
      callId: "observe-2",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "observe",
      turnId: "turn-1",
    });
    const nextSnapshotId = String(
      (observedAgain.data as { snapshotId?: string }).snapshotId,
    );
    const stalePreflight = await harness.host.executeTool({
      arguments: {
        ...argumentsValue,
        snapshotId: nextSnapshotId,
      },
      callId: "click-sensitive-2",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "click",
      turnId: "turn-1",
    });
    await harness.host.invoke(harness.window as never, "browser_tab_reload", {
      tabId: "tab-1",
    });
    await expect(
      harness.host.executeTool({
        approvalToken: stalePreflight.approval?.approvalToken,
        arguments: {
          ...argumentsValue,
          snapshotId: nextSnapshotId,
        },
        callId: "click-sensitive-2",
        ownerWebContentsId: 41,
        phase: "approvedExecute",
        threadId: "thread-1",
        tool: "click",
        turnId: "turn-1",
      }),
    ).rejects.toThrow("approval token is stale or invalid");
  });

  it.each([
    [
      "mouse",
      "before-mouse-event",
      { button: "left", type: "mouseDown", x: 10, y: 10 },
    ],
    ["keyboard", "before-input-event", { key: "x", type: "keyDown" }],
  ])(
    "invalidates pending approval when native %s input takes control",
    async (_kind, eventName, input) => {
      const harness = createHarness();
      const mounted = (await mount(harness)) as { viewId: string };
      await harness.host.executeTool({
        arguments: {
          pageRevision: 0,
          tabId: "tab-1",
          title: "Example",
          url: "https://example.com/",
        },
        callId: "claim-1",
        ownerWebContentsId: 41,
        threadId: "thread-1",
        tool: "claimTab",
        turnId: "turn-1",
      });
      const observed = await harness.host.executeTool({
        arguments: { tabId: "tab-1" },
        callId: "observe-1",
        ownerWebContentsId: 41,
        threadId: "thread-1",
        tool: "observe",
        turnId: "turn-1",
      });
      const native = harness.views.get(mounted.viewId);
      if (!native) {
        throw new Error("missing Browser test view");
      }
      native.webContents.nodeAttributes = ["aria-label", "Delete account"];
      const argumentsValue = {
        backendNodeId: 11,
        snapshotId: String(
          (observed.data as { snapshotId?: string }).snapshotId,
        ),
        tabId: "tab-1",
      };
      const preflight = await harness.host.executeTool({
        arguments: argumentsValue,
        callId: "click-sensitive-1",
        ownerWebContentsId: 41,
        threadId: "thread-1",
        tool: "click",
        turnId: "turn-1",
      });

      native.webContents.emit(eventName, {}, input);

      expect(harness.events.at(-1)).toEqual({
        event: "browser-tab-state",
        payload: expect.objectContaining({
          activeTurnId: null,
          controlOwner: "user",
          pageRevision: 1,
          tabId: "tab-1",
        }),
      });
      expect(native.webContents.debugger.detach).toHaveBeenCalledOnce();
      await expect(
        harness.host.executeTool({
          approvalToken: preflight.approval?.approvalToken,
          arguments: argumentsValue,
          callId: "click-sensitive-1",
          ownerWebContentsId: 41,
          phase: "approvedExecute",
          threadId: "thread-1",
          tool: "click",
          turnId: "turn-1",
        }),
      ).rejects.toThrow("approval token is stale or invalid");
    },
  );

  it("在 native 用户接管时请求 canonical turn interrupt", async () => {
    const harness = createHarness();
    const interrupt = vi.fn(async () => undefined);
    harness.host.setTurnInterruptHandler(interrupt);
    const mounted = (await mount(harness)) as { viewId: string };
    await harness.host.executeTool({
      arguments: {
        pageRevision: 0,
        tabId: "tab-1",
        title: "Example",
        url: "https://example.com/",
      },
      callId: "claim-1",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "claimTab",
      turnId: "turn-1",
    });

    const native = harness.views.get(mounted.viewId);
    if (!native) {
      throw new Error("missing Browser test view");
    }
    native.webContents.emit(
      "before-mouse-event",
      {},
      {
        button: "left",
        type: "mouseDown",
        x: 10,
        y: 10,
      },
    );

    await vi.waitFor(() => {
      expect(interrupt).toHaveBeenCalledWith("thread-1", "turn-1");
    });
  });

  it("rejects stale snapshots after an Agent action", async () => {
    const harness = createHarness();
    await mount(harness);
    await harness.host.executeTool({
      arguments: {
        pageRevision: 0,
        tabId: "tab-1",
        title: "Example",
        url: "https://example.com/",
      },
      callId: "claim-1",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "claimTab",
      turnId: "turn-1",
    });
    const observed = await harness.host.executeTool({
      arguments: { tabId: "tab-1" },
      callId: "observe-1",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "observe",
      turnId: "turn-1",
    });
    const snapshotId = String(
      (observed.data as { snapshotId?: string }).snapshotId,
    );

    const clicked = await harness.host.executeTool({
      arguments: { backendNodeId: 11, snapshotId, tabId: "tab-1" },
      callId: "click-1",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "click",
      turnId: "turn-1",
    });
    expect(clicked.state?.pageRevision).toBe(1);
    await expect(
      harness.host.executeTool({
        arguments: { backendNodeId: 11, snapshotId, tabId: "tab-1" },
        callId: "click-2",
        ownerWebContentsId: 41,
        threadId: "thread-1",
        tool: "click",
        turnId: "turn-1",
      }),
    ).rejects.toThrow("snapshot is stale");
  });

  it("fails route identity and stale turn mismatches closed", async () => {
    const harness = createHarness();
    await mount(harness);

    await expect(
      mount(harness, { browserSessionId: "forged-session" }),
    ).rejects.toThrow("Browser route identity mismatch");
    await harness.host.executeTool({
      arguments: {
        pageRevision: 0,
        tabId: "tab-1",
        title: "Example",
        url: "https://example.com/",
      },
      callId: "claim-1",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "claimTab",
      turnId: "turn-1",
    });
    await expect(
      harness.host.executeTool({
        arguments: {
          pageRevision: 0,
          tabId: "tab-1",
          title: "Example",
          url: "https://example.com/",
        },
        callId: "release-stale",
        ownerWebContentsId: 41,
        threadId: "thread-1",
        tool: "releaseTab",
        turnId: "turn-stale",
      }),
    ).rejects.toThrow("claimed by the active turn");
    await expect(
      harness.host.executeTool({
        arguments: { tabId: "tab-1" },
        callId: "claim-wrong-owner",
        ownerWebContentsId: 99,
        threadId: "thread-1",
        tool: "claimTab",
        turnId: "turn-1",
      }),
    ).rejects.toThrow("stale or unavailable");
  });

  it("forwards permission and download events with the canonical native tab identity", async () => {
    const harness = createHarness();
    const mounted = (await mount(harness)) as {
      viewId: string;
      webContentsId: number;
    };

    harness.host.observeEmbeddedEvent(
      "embedded-browser-view-permission-request",
      {
        decision: "blocked",
        embeddingOrigin: "https://example.com",
        permission: "geolocation",
        requestId: "permission-1",
        requestingUrl: "https://example.com/",
        url: "https://example.com/",
        viewId: mounted.viewId,
      },
    );
    harness.host.observeEmbeddedEvent("embedded-browser-view-download", {
      canResume: false,
      downloadId: "download-1",
      filename: "report.pdf",
      mimeType: "application/pdf",
      receivedBytes: 100,
      state: "completed",
      totalBytes: 100,
      url: "https://example.com/report.pdf",
      viewId: mounted.viewId,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    for (const event of [
      "browser-tab-permission-request",
      "browser-tab-download",
    ]) {
      expect(harness.events).toContainEqual({
        event,
        payload: expect.objectContaining({
          browserSessionId: "browser-session-1",
          ownerWebContentsId: 41,
          tabId: "tab-1",
          threadId: "thread-1",
          viewId: mounted.viewId,
          webContentsId: mounted.webContentsId,
          windowId: 7,
        }),
      });
    }
    expect(harness.artifactWriter).toHaveBeenCalledOnce();
  });

  it("publishes a completed download only after an artifact receipt is persisted", async () => {
    const harness = createHarness();
    const mounted = (await mount(harness)) as { viewId: string };
    harness.host.observeEmbeddedEvent("embedded-browser-view-download", {
      canResume: false,
      downloadId: "download-2",
      filename: "report.pdf",
      mimeType: "application/pdf",
      receivedBytes: 100,
      state: "completed",
      totalBytes: 100,
      url: "https://example.com/report.pdf",
      viewId: mounted.viewId,
    });
    expect(
      harness.events.some(({ event }) => event === "browser-tab-download"),
    ).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const download = harness.events.find(
      ({ event }) => event === "browser-tab-download",
    );
    const writeParams = harness.artifactWriter.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    const writeArtifact = writeParams?.artifact as
      | Record<string, unknown>
      | undefined;
    expect(download?.payload).toEqual(
      expect.objectContaining({
        artifactRef: expect.stringMatching(/^browser-artifact-/),
        artifactPersistedAt: "2026-08-23T00:00:00.000Z",
        artifactSidecarPath: "sessions/test/runtime-artifacts/download.json",
        artifactContentStatus: "available",
      }),
    );
    expect(writeArtifact).not.toHaveProperty("path");
    expect(JSON.stringify(download?.payload)).not.toContain(process.execPath);
  });

  it("fails closed when artifact persistence returns an invalid receipt", async () => {
    const harness = createHarness();
    harness.host.setArtifactWriter(async () => ({
      artifactRef: "different-ref",
      persistedAt: "2026-08-23T00:00:00.000Z",
      sidecar: {
        relativePath: "/private/absolute/path",
        bytes: 1,
        sha256: "bad",
        contentStatus: "available",
      },
    }));
    const mounted = (await mount(harness)) as { viewId: string };
    harness.host.observeEmbeddedEvent("embedded-browser-view-download", {
      canResume: false,
      downloadId: "download-3",
      filename: "report.pdf",
      mimeType: "application/pdf",
      receivedBytes: 100,
      state: "completed",
      totalBytes: 100,
      url: "https://example.com/report.pdf",
      viewId: mounted.viewId,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const download = harness.events.find(
      ({ event }) => event === "browser-tab-download",
    );
    expect(download?.payload).toEqual(
      expect.objectContaining({
        artifactStatus: "failed",
        artifactError: "Artifact could not be persisted",
      }),
    );
    expect(JSON.stringify(download?.payload)).not.toContain("/private");
    expect(JSON.stringify(download?.payload)).not.toContain("different-ref");
  });

  it("covers artifact, clipboard, upload and permission actions with turn-scoped evidence", async () => {
    const harness = createHarness();
    const mounted = (await mount(harness)) as { viewId: string };
    await harness.host.executeTool({
      arguments: {
        pageRevision: 0,
        tabId: "tab-1",
        title: "Example",
        url: "https://example.com/",
      },
      callId: "claim-1",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "claimTab",
      turnId: "turn-1",
    });

    harness.host.observeEmbeddedEvent("embedded-browser-view-download", {
      canResume: false,
      downloadId: "download-actions",
      filename: "report.pdf",
      mimeType: "application/pdf",
      receivedBytes: 100,
      state: "completed",
      totalBytes: 100,
      url: "https://example.com/report.pdf",
      viewId: mounted.viewId,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const artifactRef = String(
      (
        harness.events.find(({ event }) => event === "browser-tab-download")
          ?.payload as { artifactRef?: string }
      )?.artifactRef,
    );
    expect(artifactRef).toMatch(/^browser-artifact-/);

    const common = {
      ownerWebContentsId: 41,
      threadId: "thread-1",
      turnId: "turn-1",
    } as const;
    const runApproved = async (
      tool: string,
      argumentsValue: Record<string, unknown>,
      callId: string,
    ) => {
      const preflight = await harness.host.executeTool({
        ...common,
        arguments: argumentsValue,
        callId,
        tool,
      });
      expect(preflight).toMatchObject({
        status: "approval_required",
        approval: {
          approvalToken: expect.any(String),
          tabId: "tab-1",
          viewId: mounted.viewId,
          webContentsId: 100,
        },
      });
      const approved = await harness.host.executeTool({
        ...common,
        approvalToken: preflight.approval?.approvalToken,
        arguments: argumentsValue,
        callId,
        phase: "approvedExecute",
        tool,
      });
      expect(approved.status).toBe("completed");
      const data = approved.data as {
        grantId: string;
        grantScope: string;
        expiresAt: string;
        evidence: Record<string, unknown>;
      };
      expect(data.grantId).toMatch(/^turn-grant-/);
      expect(data.grantScope).toBe("turn");
      expect(Number.isNaN(Date.parse(data.expiresAt))).toBe(false);
      expect(data.evidence).toMatchObject({
        actionKind: expect.any(String),
        callId,
        threadId: "thread-1",
        turnId: "turn-1",
        browserSessionId: "browser-session-1",
        tabId: "tab-1",
        viewId: mounted.viewId,
        windowId: 7,
        ownerWebContentsId: 41,
        webContentsId: 100,
        grantId: data.grantId,
        grantScope: "turn",
        expiresAt: data.expiresAt,
      });
      return { approved, preflight };
    };

    await runApproved("openArtifact", { artifactRef }, "open-artifact-1");
    expect(shellOpenPathMock).toHaveBeenCalledWith(process.execPath);
    await runApproved("revealArtifact", { artifactRef }, "reveal-artifact-1");
    expect(shellShowItemInFolderMock).toHaveBeenCalledWith(process.execPath);
    await runApproved(
      "copyArtifactRef",
      { artifactRef },
      "copy-artifact-ref-1",
    );
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(artifactRef);

    const readClipboard = await runApproved(
      "readClipboard",
      {},
      "read-clipboard-1",
    );
    expect((readClipboard.approved.data as { text: string }).text).toBe(
      "clipboard-before",
    );
    await runApproved(
      "writeClipboard",
      { text: "clipboard-after" },
      "write-clipboard-1",
    );
    expect(clipboardWriteTextMock).toHaveBeenCalledWith("clipboard-after");

    const native = harness.views.get(mounted.viewId);
    if (!native) {
      throw new Error("missing Browser test view");
    }
    native.webContents.nodeAttributes = ["type", "file"];
    const observed = await harness.host.executeTool({
      ...common,
      arguments: { tabId: "tab-1" },
      callId: "observe-upload-1",
      tool: "observe",
    });
    const snapshotId = String(
      (observed.data as { snapshotId?: string }).snapshotId,
    );
    await runApproved(
      "uploadArtifact",
      { artifactRef, backendNodeId: 11, snapshotId, tabId: "tab-1" },
      "upload-artifact-1",
    );
    expect(native.webContents.debugger.sendCommand).toHaveBeenCalledWith(
      "DOM.setFileInputFiles",
      { backendNodeId: 11, files: [process.execPath] },
    );

    harness.host.observeEmbeddedEvent(
      "embedded-browser-view-permission-request",
      {
        decision: "pending",
        embeddingOrigin: "https://example.com",
        permission: "geolocation",
        requestId: "permission-actions-1",
        requestingUrl: "https://example.com/",
        url: "https://example.com/",
        viewId: mounted.viewId,
      },
    );
    await runApproved(
      "grantPermission",
      { permission: "geolocation", requestId: "permission-actions-1" },
      "grant-permission-1",
    );
    expect(harness.embeddedHost.resolvePermission).toHaveBeenCalledWith(
      "permission-actions-1",
      true,
      mounted.viewId,
    );

    const staleApproval = await harness.host.executeTool({
      ...common,
      arguments: { artifactRef },
      callId: "stale-after-turn-1",
      tool: "openArtifact",
    });
    harness.host.turnEnded("thread-1", "turn-1");
    await expect(
      harness.host.executeTool({
        ...common,
        approvalToken: staleApproval.approval?.approvalToken,
        arguments: { artifactRef },
        callId: "stale-after-turn-1",
        phase: "approvedExecute",
        tool: "openArtifact",
      }),
    ).rejects.toThrow("approval token is stale or invalid");

    await harness.host.executeTool({
      ownerWebContentsId: 41,
      threadId: "thread-1",
      turnId: "turn-2",
      arguments: {
        pageRevision: 1,
        tabId: "tab-1",
        title: "Example",
        url: "https://example.com/",
      },
      callId: "claim-2",
      tool: "claimTab",
    });
    const artifactGone = await harness.host.executeTool({
      ownerWebContentsId: 41,
      threadId: "thread-1",
      turnId: "turn-2",
      arguments: { artifactRef },
      callId: "artifact-gone-1",
      tool: "openArtifact",
    });
    await expect(
      harness.host.executeTool({
        ownerWebContentsId: 41,
        threadId: "thread-1",
        turnId: "turn-2",
        approvalToken: artifactGone.approval?.approvalToken,
        arguments: { artifactRef },
        callId: "artifact-gone-1",
        phase: "approvedExecute",
        tool: "openArtifact",
      }),
    ).rejects.toThrow("artifact ref is stale");
  });

  it("releases retained user tabs and closes Agent tabs when the turn ends", async () => {
    const harness = createHarness();
    await mount(harness);
    await harness.host.executeTool({
      arguments: {
        pageRevision: 0,
        tabId: "tab-1",
        title: "Example",
        url: "https://example.com/",
      },
      callId: "claim-1",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "claimTab",
      turnId: "turn-1",
    });
    await harness.host.executeTool({
      arguments: {
        pageRevision: 0,
        tabId: "tab-1",
        title: "Example",
        url: "https://example.com/",
      },
      callId: "observe-1",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "observe",
      turnId: "turn-1",
    });
    await harness.host.executeTool({
      arguments: { url: "https://example.org/" },
      callId: "new-tab-1",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "newTab",
      turnId: "turn-1",
    });

    harness.host.turnEnded("thread-1", "turn-1");

    expect(harness.events).toContainEqual({
      event: "browser-tab-closed",
      payload: expect.objectContaining({ reason: "turn-ended" }),
    });
    expect(
      harness.events.some(
        ({ event, payload }) =>
          event === "browser-tab-state" &&
          (payload as { tabId?: string }).tabId === "tab-1" &&
          (payload as { controlOwner?: string }).controlOwner === "released",
      ),
    ).toBe(true);
    const retained = [...harness.views.values()].find(
      ({ webContents }) => webContents.id === 100,
    );
    expect(retained?.webContents.debugger.detach).toHaveBeenCalledOnce();
  });

  it("releases user tabs and closes Agent tabs when the App Server disconnects", async () => {
    const harness = createHarness();
    await mount(harness);
    await harness.host.executeTool({
      arguments: {
        pageRevision: 0,
        tabId: "tab-1",
        title: "Example",
        url: "https://example.com/",
      },
      callId: "claim-1",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "claimTab",
      turnId: "turn-1",
    });
    await harness.host.executeTool({
      arguments: { tabId: "tab-1" },
      callId: "observe-1",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "observe",
      turnId: "turn-1",
    });

    harness.host.connectionLost("app-server-disconnected");

    expect(
      harness.events.some(
        ({ event, payload }) =>
          event === "browser-tab-state" &&
          (payload as { tabId?: string }).tabId === "tab-1" &&
          (payload as { controlOwner?: string }).controlOwner === "released",
      ),
    ).toBe(true);
    const retained = [...harness.views.values()].find(
      ({ webContents }) => webContents.id === 100,
    );
    expect(retained?.webContents.debugger.detach).toHaveBeenCalledOnce();

    const agentTab = await harness.host.executeTool({
      arguments: { url: "https://example.org/" },
      callId: "new-tab-1",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "newTab",
      turnId: "turn-2",
    });
    expect(agentTab.state?.origin).toBe("agent");
    harness.host.connectionLost("app-server-disconnected");
    expect(harness.events).toContainEqual({
      event: "browser-tab-closed",
      payload: expect.objectContaining({
        reason: "app-server-disconnected",
        tabId: "new-tab-1",
      }),
    });
  });
});
