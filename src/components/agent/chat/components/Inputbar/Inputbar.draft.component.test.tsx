import {
  mountedRoots,
  createRichSkillRestoreDraft,
  mockInputbarCore,
} from "./Inputbar.testFixtures";
import { Inputbar } from "./index";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { describe, expect, it, vi } from "vitest";

import type { Skill } from "@/lib/api/skills";

import type { RuntimeSubmissionResult } from "../../hooks/agentSendResult";
import { acceptedSubmission } from "../../hooks/agentSendResult.testFixtures";
import { ComposerController } from "@/components/input-kit";
import {
  COMPOSER_EDITOR_SELECTOR,
  setComposerEditorText,
} from "@/components/input-kit/composerEditor.testUtils";

describe("Inputbar draft current integration", () => {
  it("重挂载收到相同恢复请求时保留后续编辑，新的请求仍可恢复", async () => {
    const controller = new ComposerController();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    function RestoreReplayHarness({ requestId }: { requestId: string }) {
      const snapshot = React.useSyncExternalStore(
        controller.subscribe,
        controller.getSnapshot,
      );
      const request = React.useMemo(
        () => ({
          requestId,
          reason: "output_free_interrupted_turn" as const,
          draft: { text: "恢复正文" },
        }),
        [requestId],
      );
      return (
        <Inputbar
          composerController={controller}
          input={snapshot.document.text}
          setInput={(text) => controller.setText(text)}
          onSend={vi.fn()}
          isLoading={false}
          inputRestoreRequest={request}
        />
      );
    }
    await act(async () => {
      root.render(<RestoreReplayHarness requestId="restore-original" />);
    });
    const editor = container.querySelector<HTMLElement>(
      COMPOSER_EDITOR_SELECTOR,
    )!;
    await act(async () => {
      await setComposerEditorText(editor, "恢复后的新输入");
    });
    const newDraft = controller.captureDraft();
    const revision = controller.getSnapshot().revision;
    await act(async () => {
      root.render(
        <RestoreReplayHarness key="remount" requestId="restore-original" />,
      );
    });
    expect(controller.captureDraft()).toEqual(newDraft);
    expect(controller.getSnapshot().revision).toBe(revision);
    await act(async () => {
      root.render(
        <RestoreReplayHarness key="remount" requestId="restore-next" />,
      );
    });
    expect(controller.getDocument().text).toBe("恢复正文");
    expect(controller.getSnapshot().revision).toBeGreaterThan(revision);
  });

  it("入口预选在共享草稿中只消费一次，重新挂载不覆盖用户选择", async () => {
    const initialSkill: Skill = {
      key: "local:initial",
      name: "入口技能",
      description: "初始能力",
      directory: "initial",
      installed: true,
      sourceKind: "other",
    };
    const chosenSkill: Skill = {
      key: "local:chosen",
      name: "用户技能",
      description: "用户选择",
      directory: "chosen",
      installed: true,
      sourceKind: "other",
    };
    const controller = new ComposerController({ text: "请保留我的选择" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    function InitializationHarness({ requestKey }: { requestKey: number }) {
      const snapshot = React.useSyncExternalStore(
        controller.subscribe,
        controller.getSnapshot,
      );
      return (
        <Inputbar
          composerController={controller}
          input={snapshot.document.text}
          setInput={(text) => controller.setText(text)}
          onSend={vi.fn()}
          isLoading={false}
          skills={[initialSkill, chosenSkill]}
          initialInputCapability={{
            requestKey,
            skill: initialSkill,
          }}
        />
      );
    }
    await act(async () => {
      root.render(<InitializationHarness requestKey={1} />);
    });
    await act(async () => {
      mockInputbarCore.mock.lastCall?.[0].contextualSuggestions.onSelectInputCapability?.(
        {
          kind: "installed_skill",
          skill: chosenSkill,
        },
      );
    });
    const chosenDraft = controller.captureDraft();
    const revision = controller.getSnapshot().revision;
    expect(chosenDraft.inputCapabilityRoute).toBeUndefined();
    expect(chosenDraft.mentionBindings.map((binding) => binding.id)).toEqual([
      "local:initial",
      "local:chosen",
    ]);
    await act(async () => {
      root.render(<InitializationHarness key="next-surface" requestKey={1} />);
    });
    expect(controller.captureDraft()).toEqual(chosenDraft);
    expect(controller.getSnapshot().revision).toBe(revision);
    await act(async () => {
      root.render(<InitializationHarness key="next-surface" requestKey={2} />);
    });
    expect(controller.getDocument().mentionBindings).toEqual(
      chosenDraft.mentionBindings,
    );
    expect(controller.getDocument().inputCapabilityRoute).toBeUndefined();
    await act(async () => {
      controller.clear();
      root.render(
        <InitializationHarness key="after-scope-reset" requestKey={2} />,
      );
    });
    expect(controller.getDocument().text).toBe("");
    expect(controller.getDocument().inputCapabilityRoute).toBeUndefined();
    expect(container.querySelector('[data-composer-token="skill"]')).toBeNull();
  });

  it("共享草稿跨输入 surface 挂载保留 JSON、图片、路径与能力", async () => {
    const skill: Skill = {
      key: "local:draft",
      name: "起草",
      description: "草稿能力",
      directory: "draft",
      installed: true,
      sourceKind: "other",
    };
    const pathReference = {
      id: "file:/tmp/report.md",
      path: "/tmp/report.md",
      name: "report.md",
      isDir: false,
      source: "file_manager" as const,
    };
    const { images: _images, ...draft } = createRichSkillRestoreDraft(
      skill,
      pathReference,
    );
    const controller = new ComposerController(draft);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    function SharedDraftHarness() {
      const snapshot = React.useSyncExternalStore(
        controller.subscribe,
        controller.getSnapshot,
      );
      const [paths, setPaths] = React.useState([pathReference]);
      return (
        <Inputbar
          composerController={controller}
          input={snapshot.document.text}
          setInput={(text) => controller.setText(text)}
          onSend={vi.fn()}
          isLoading={false}
          skills={[skill]}
          pathReferences={paths}
          onClearPathReferences={() => setPaths([])}
          onAddPathReferences={(references) =>
            setPaths(references as typeof paths)
          }
        />
      );
    }
    for (const key of ["home-handoff", "chat-remount"]) {
      await act(async () => {
        root.render(<SharedDraftHarness key={key} />);
      });
      const props = mockInputbarCore.mock.lastCall?.[0];
      expect(props?.controller).toBe(controller);
      expect(controller.captureDraft()).toEqual(expect.objectContaining(draft));
      expect(props?.pendingImages).toEqual(draft.attachments);
      expect(props?.pathReferences).toEqual(draft.pathReferences);
      expect(
        container
          .querySelector('[data-composer-token="skill"]')
          ?.getAttribute("data-composer-path"),
      ).toBe("draft/SKILL.md");
    }
  });

  it("真实历史按键同时恢复和离开完整富草稿的资源", async () => {
    const skill: Skill = {
      key: "local:draft",
      name: "起草",
      description: "草稿能力",
      directory: "draft",
      installed: true,
      sourceKind: "other",
    };
    const pathReference = {
      id: "file:/tmp/report.md",
      path: "/tmp/report.md",
      name: "report.md",
      isDir: false,
      source: "file_manager" as const,
    };
    const { images: _images, ...draft } = createRichSkillRestoreDraft(
      skill,
      pathReference,
    );
    const controller = new ComposerController(draft);
    const receipt = controller.submit("start");
    if (receipt.kind !== "accepted") throw new Error("rich draft was empty");
    expect(controller.commit(receipt)).toBe(true);
    const onSend = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    function HistoryHarness() {
      const snapshot = React.useSyncExternalStore(
        controller.subscribe,
        controller.getSnapshot,
      );
      const [paths, setPaths] = React.useState<(typeof pathReference)[]>([]);
      return (
        <Inputbar
          composerController={controller}
          input={snapshot.document.text}
          setInput={(text) => controller.setText(text)}
          onSend={onSend}
          isLoading={false}
          skills={[skill]}
          pathReferences={paths}
          onClearPathReferences={() => setPaths([])}
          onAddPathReferences={(references) =>
            setPaths(references as typeof paths)
          }
        />
      );
    }
    await act(async () => {
      root.render(<HistoryHarness />);
    });
    const editor = container.querySelector<HTMLElement>(
      COMPOSER_EDITOR_SELECTOR,
    )!;
    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowUp",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    let props = mockInputbarCore.mock.lastCall?.[0];
    expect(controller.captureDraft()).toEqual(expect.objectContaining(draft));
    expect(props?.pendingImages).toEqual(draft.attachments);
    expect(props?.pathReferences).toEqual(draft.pathReferences);
    expect(
      editor.querySelector('[data-composer-token="skill"]'),
    ).not.toBeNull();
    await act(async () => {
      controller.setSelection(controller.getDocument().text.length);
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    props = mockInputbarCore.mock.lastCall?.[0];
    expect(controller.getDocument().text).toBe("");
    expect(props?.pendingImages).toEqual([]);
    expect(props?.pathReferences).toEqual([]);
    expect(controller.getDocument().inputCapabilityRoute).toBeUndefined();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("收到完整中断草稿时即使仍在 loading 也应恢复文本、图片、路径和技能 atom", async () => {
    const onInputRestoreRequestHandled = vi.fn();
    const pathReference = {
      id: "file:/tmp/report.md",
      path: "/tmp/report.md",
      name: "report.md",
      isDir: false,
      source: "file_manager" as const,
    };
    const skill: Skill = {
      key: "local:draft",
      name: "起草",
      description: "恢复输入用技能",
      directory: "draft",
      installed: true,
      sourceKind: "other",
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    function RestoreHarness() {
      const [input, setInput] = React.useState("");
      const [pathReferences, setPathReferences] = React.useState<
        (typeof pathReference)[]
      >([]);
      const [restoreRequest, setRestoreRequest] = React.useState<
        React.ComponentProps<typeof Inputbar>["inputRestoreRequest"]
      >({
        requestId: "restore-1",
        reason: "output_free_interrupted_turn",
        draft: createRichSkillRestoreDraft(skill, pathReference),
      });

      return (
        <Inputbar
          input={input}
          setInput={setInput}
          onSend={vi.fn()}
          isLoading={true}
          skills={[skill]}
          pathReferences={pathReferences}
          onClearPathReferences={() => setPathReferences([])}
          onAddPathReferences={(references) =>
            setPathReferences(references as (typeof pathReference)[])
          }
          inputRestoreRequest={restoreRequest}
          onInputRestoreRequestHandled={(requestId) => {
            onInputRestoreRequestHandled(requestId);
            setRestoreRequest(null);
          }}
        />
      );
    }

    await act(async () => {
      root.render(<RestoreHarness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await Promise.resolve();
    });

    const latestCoreProps =
      mockInputbarCore.mock.calls[mockInputbarCore.mock.calls.length - 1]?.[0];
    expect(latestCoreProps?.text).toBe("$起草 继续生成提纲");
    expect(latestCoreProps?.controller.getDocument().editorDocument).toEqual(
      createRichSkillRestoreDraft(skill, pathReference).editorDocument,
    );
    expect(latestCoreProps?.pathReferences).toEqual([pathReference]);
    expect(latestCoreProps?.pendingImages).toEqual([
      {
        data: "image-data",
        mediaType: "image/png",
      },
    ]);
    expect(
      container
        .querySelector('[data-composer-token="skill"]')
        ?.getAttribute("data-composer-path"),
    ).toBe("draft/SKILL.md");
    expect(onInputRestoreRequestHandled).toHaveBeenCalledWith("restore-1");
  });

  it("发送 Promise 未结束时收到恢复请求，不应让旧发送清理刚恢复的富输入", async () => {
    const onInputRestoreRequestHandled = vi.fn();
    const pathReference = {
      id: "file:/tmp/report.md",
      path: "/tmp/report.md",
      name: "report.md",
      isDir: false,
      source: "file_manager" as const,
    };
    const skill: Skill = {
      key: "local:draft",
      name: "起草",
      description: "恢复输入用技能",
      directory: "draft",
      installed: true,
      sourceKind: "other",
    };
    let resolveSend: ((value: RuntimeSubmissionResult) => void) | null = null;
    let triggerRestore: (() => void) | null = null;
    const onSend = vi.fn(
      () =>
        new Promise<RuntimeSubmissionResult>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    function RestoreDuringSendHarness() {
      const [input, setInput] = React.useState("请结合现有资料生成提纲");
      const [pathReferences, setPathReferences] = React.useState<
        (typeof pathReference)[]
      >([]);
      const [restoreRequest, setRestoreRequest] =
        React.useState<
          React.ComponentProps<typeof Inputbar>["inputRestoreRequest"]
        >(null);

      triggerRestore = () =>
        setRestoreRequest({
          requestId: "restore-during-send",
          reason: "output_free_interrupted_turn",
          draft: createRichSkillRestoreDraft(skill, pathReference),
        });

      return (
        <Inputbar
          input={input}
          setInput={setInput}
          onSend={onSend}
          isLoading={false}
          skills={[skill]}
          pathReferences={pathReferences}
          onClearPathReferences={() => setPathReferences([])}
          onAddPathReferences={(references) =>
            setPathReferences(references as (typeof pathReference)[])
          }
          initialInputCapability={{
            requestKey: 1,
            skill,
          }}
          inputRestoreRequest={restoreRequest}
          onInputRestoreRequestHandled={(requestId) => {
            onInputRestoreRequestHandled(requestId);
            setRestoreRequest(null);
          }}
        />
      );
    }

    await act(async () => {
      root.render(<RestoreDuringSendHarness />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const firstCoreProps =
      mockInputbarCore.mock.calls[mockInputbarCore.mock.calls.length - 1]?.[0];
    let sendPromise: Promise<unknown> | undefined;
    await act(async () => {
      sendPromise = Promise.resolve(firstCoreProps?.onSend?.());
      await Promise.resolve();
    });
    expect(onSend).toHaveBeenCalledTimes(1);

    await act(async () => {
      triggerRestore?.();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await Promise.resolve();
    });

    let latestCoreProps =
      mockInputbarCore.mock.calls[mockInputbarCore.mock.calls.length - 1]?.[0];
    expect(latestCoreProps?.text).toBe("$起草 继续生成提纲");
    expect(latestCoreProps?.pathReferences).toEqual([pathReference]);
    expect(latestCoreProps?.pendingImages).toEqual([
      {
        data: "image-data",
        mediaType: "image/png",
      },
    ]);
    expect(
      container
        .querySelector('[data-composer-token="skill"]')
        ?.getAttribute("data-composer-path"),
    ).toBe("draft/SKILL.md");

    await act(async () => {
      resolveSend?.(acceptedSubmission());
      await sendPromise;
      await Promise.resolve();
    });

    latestCoreProps =
      mockInputbarCore.mock.calls[mockInputbarCore.mock.calls.length - 1]?.[0];
    expect(latestCoreProps?.text).toBe("$起草 继续生成提纲");
    expect(latestCoreProps?.controller.getDocument().editorDocument).toEqual(
      createRichSkillRestoreDraft(skill, pathReference).editorDocument,
    );
    expect(latestCoreProps?.pathReferences).toEqual([pathReference]);
    expect(latestCoreProps?.pendingImages).toEqual([
      {
        data: "image-data",
        mediaType: "image/png",
      },
    ]);
    expect(
      container
        .querySelector('[data-composer-token="skill"]')
        ?.getAttribute("data-composer-path"),
    ).toBe("draft/SKILL.md");
    expect(onInputRestoreRequestHandled).toHaveBeenCalledWith(
      "restore-during-send",
    );
  });
});
