import React, { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMediaTaskArtifact,
  listMediaTaskArtifacts,
  type ListMediaTaskArtifactsOutput,
  type MediaTaskArtifactOutput,
} from "@/lib/api/mediaTasks";
import { safeListen } from "@/lib/dev-bridge";
import type { Message } from "../types";
import { useWorkspaceAudioTaskPreviewRuntime } from "./useWorkspaceAudioTaskPreviewRuntime";

vi.mock("@/lib/api/mediaTasks", () => ({
  getMediaTaskArtifact: vi.fn(),
  listMediaTaskArtifacts: vi.fn(),
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeListen: vi.fn(),
}));

type HookProps = Parameters<typeof useWorkspaceAudioTaskPreviewRuntime>[0];

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

function buildRunningAudioMessage(): Message {
  return {
    id: "assistant-audio-1",
    role: "assistant",
    content: "配音任务已创建。",
    timestamp: new Date("2026-04-30T00:00:00.000Z"),
    taskPreview: {
      kind: "audio_generate",
      taskId: "task-audio-1",
      taskType: "audio_generate",
      prompt: "请生成温暖旁白",
      title: "配音生成任务",
      status: "running",
      artifactPath: ".lime/runtime/audio-generate/task-audio-1.md",
      taskFilePath: ".lime/tasks/audio_generate/task-audio-1.json",
      sourceText: "请生成温暖旁白",
      voice: "warm_narrator",
      audioUrl: null,
      mimeType: null,
      durationMs: null,
    },
  };
}

function buildCompletedAudioArtifact(): MediaTaskArtifactOutput {
  return {
    success: true,
    task_id: "task-audio-1",
    task_type: "audio_generate",
    task_family: "audio",
    status: "succeeded",
    normalized_status: "succeeded",
    current_attempt_id: "attempt-1",
    path: ".lime/tasks/audio_generate/task-audio-1.json",
    absolute_path: "/workspace/.lime/tasks/audio_generate/task-audio-1.json",
    artifact_path: ".lime/tasks/audio_generate/task-audio-1.json",
    absolute_artifact_path:
      "/workspace/.lime/tasks/audio_generate/task-audio-1.json",
    reused_existing: false,
    record: {
      task_id: "task-audio-1",
      task_type: "audio_generate",
      task_family: "audio",
      payload: {
        source_text: "请生成温暖旁白",
        voice: "warm_narrator",
        provider_id: "limecore",
        model: "voice-pro",
        modality_contract_key: "voice_generation",
        audio_path: ".lime/runtime/audio/task-audio-1.mp3",
        mime_type: "audio/mpeg",
        duration_ms: 1800,
        audio_output: {
          kind: "audio_output",
          status: "completed",
          audio_path: ".lime/runtime/audio/task-audio-1.mp3",
          mime_type: "audio/mpeg",
          duration_ms: 1800,
          source_text: "请生成温暖旁白",
          voice: "warm_narrator",
          provider_id: "limecore",
          model: "voice-pro",
        },
      },
      status: "succeeded",
      normalized_status: "succeeded",
      created_at: "2026-04-30T00:00:00.000Z",
      result: {
        kind: "audio_generation_result",
        status: "completed",
        audio_path: ".lime/runtime/audio/task-audio-1.mp3",
        audio_output: {
          kind: "audio_output",
          status: "completed",
          audio_path: ".lime/runtime/audio/task-audio-1.mp3",
          mime_type: "audio/mpeg",
          duration_ms: 1800,
        },
      },
    },
  };
}

function buildFailedAudioArtifact(): MediaTaskArtifactOutput {
  return {
    success: true,
    task_id: "task-audio-1",
    task_type: "audio_generate",
    task_family: "audio",
    status: "failed",
    normalized_status: "failed",
    current_attempt_id: "attempt-1",
    path: ".lime/tasks/audio_generate/task-audio-1.json",
    absolute_path: "/workspace/.lime/tasks/audio_generate/task-audio-1.json",
    artifact_path: ".lime/tasks/audio_generate/task-audio-1.json",
    absolute_artifact_path:
      "/workspace/.lime/tasks/audio_generate/task-audio-1.json",
    reused_existing: false,
    record: {
      task_id: "task-audio-1",
      task_type: "audio_generate",
      task_family: "audio",
      payload: {
        source_text: "请生成温暖旁白",
        voice: "warm_narrator",
        provider_id: "missing-provider",
        model: "voice-pro",
        modality_contract_key: "voice_generation",
        audio_output: {
          kind: "audio_output",
          status: "failed",
          mime_type: "audio/mpeg",
          source_text: "请生成温暖旁白",
          voice: "warm_narrator",
          provider_id: "missing-provider",
          model: "voice-pro",
          error_code: "audio_provider_unconfigured",
          error_message:
            "未找到可用的 voice_generation provider/API Key: missing-provider。",
          retryable: true,
          stage: "provider_config",
        },
      },
      status: "failed",
      normalized_status: "failed",
      created_at: "2026-04-30T00:00:00.000Z",
      last_error: {
        code: "audio_provider_unconfigured",
        message:
          "未找到可用的 voice_generation provider/API Key: missing-provider。",
        retryable: true,
        stage: "provider_config",
      },
      progress: {
        phase: "failed",
        message:
          "未找到可用的 voice_generation provider/API Key: missing-provider。",
      },
    },
  };
}

function buildEmptyAudioTaskIndex(): ListMediaTaskArtifactsOutput {
  return {
    success: true,
    workspace_root: "/workspace",
    artifact_root: "/workspace/.lime/tasks",
    filters: {
      task_family: "audio",
      task_type: "audio_generate",
      modality_contract_key: "voice_generation",
      limit: 24,
    },
    total: 0,
    modality_runtime_contracts: {
      snapshot_count: 0,
      contract_keys: [],
      blocked_count: 0,
      routing_outcomes: [],
      model_registry_assessment_count: 0,
      audio_output_count: 0,
      audio_output_statuses: [],
      audio_output_error_codes: [],
      transcript_count: 0,
      transcript_statuses: [],
      transcript_error_codes: [],
      snapshots: [],
    },
    tasks: [],
  };
}

function buildCompletedAudioTaskIndex(): ListMediaTaskArtifactsOutput {
  return {
    ...buildEmptyAudioTaskIndex(),
    total: 1,
    modality_runtime_contracts: {
      snapshot_count: 1,
      contract_keys: ["voice_generation"],
      blocked_count: 0,
      routing_outcomes: [{ outcome: "accepted", count: 1 }],
      model_registry_assessment_count: 0,
      audio_output_count: 1,
      audio_output_statuses: [{ status: "completed", count: 1 }],
      audio_output_error_codes: [],
      transcript_count: 0,
      transcript_statuses: [],
      transcript_error_codes: [],
      snapshots: [
        {
          task_id: "task-audio-1",
          task_type: "audio_generate",
          normalized_status: "succeeded",
          contract_key: "voice_generation",
          routing_slot: "voice_generation_model",
          provider_id: "limecore",
          model: "voice-pro",
          routing_event: "task_created",
          routing_outcome: "accepted",
          failure_code: null,
          audio_output_status: "completed",
          audio_output_path: ".lime/runtime/audio/task-audio-1.mp3",
          audio_output_mime_type: "audio/mpeg",
          audio_output_duration_ms: 1800,
          audio_output_error_code: null,
          audio_output_retryable: null,
        },
      ],
    },
  };
}

function buildFailedAudioTaskIndex(): ListMediaTaskArtifactsOutput {
  return {
    ...buildEmptyAudioTaskIndex(),
    total: 1,
    modality_runtime_contracts: {
      snapshot_count: 1,
      contract_keys: ["voice_generation"],
      blocked_count: 0,
      routing_outcomes: [{ outcome: "failed", count: 1 }],
      model_registry_assessment_count: 0,
      audio_output_count: 1,
      audio_output_statuses: [{ status: "failed", count: 1 }],
      audio_output_error_codes: ["audio_provider_unconfigured"],
      transcript_count: 0,
      transcript_statuses: [],
      transcript_error_codes: [],
      snapshots: [
        {
          task_id: "task-audio-1",
          task_type: "audio_generate",
          normalized_status: "failed",
          contract_key: "voice_generation",
          routing_slot: "voice_generation_model",
          provider_id: "missing-provider",
          model: "voice-pro",
          routing_event: "task_created",
          routing_outcome: "failed",
          failure_code: "audio_provider_unconfigured",
          audio_output_status: "failed",
          audio_output_path: null,
          audio_output_mime_type: null,
          audio_output_duration_ms: null,
          audio_output_error_code: "audio_provider_unconfigured",
          audio_output_retryable: true,
        },
      ],
    },
  };
}

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestMessages: Message[] = props?.messages ?? [
    buildRunningAudioMessage(),
  ];

  function Probe(currentProps: Partial<HookProps>) {
    const [messages, setMessages] = useState<Message[]>(
      currentProps.messages ?? [buildRunningAudioMessage()],
    );
    latestMessages = messages;
    useWorkspaceAudioTaskPreviewRuntime({
      projectRootPath: "/workspace",
      ...currentProps,
      messages,
      setChatMessages: setMessages,
    });
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...props} {...nextProps} />);
      await Promise.resolve();
    });
  };

  mountedRoots.push({ container, root });
  return {
    render,
    getMessages: () => latestMessages,
  };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(getMediaTaskArtifact).mockReset();
  vi.mocked(listMediaTaskArtifacts).mockReset();
  vi.mocked(listMediaTaskArtifacts).mockResolvedValue(
    buildEmptyAudioTaskIndex(),
  );
  vi.mocked(safeListen).mockReset();
  vi.mocked(safeListen).mockResolvedValue(vi.fn());
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.restoreAllMocks();
});

describe("useWorkspaceAudioTaskPreviewRuntime", () => {
  it("应优先从统一媒体任务索引恢复 audio_output 完成态而不读取隐藏 task JSON", async () => {
    vi.mocked(listMediaTaskArtifacts).mockResolvedValueOnce(
      buildCompletedAudioTaskIndex(),
    );
    const { render, getMessages } = renderHook();

    await render();

    await vi.waitFor(() => {
      expect(listMediaTaskArtifacts).toHaveBeenCalledWith({
        projectRootPath: "/workspace",
        taskFamily: "audio",
        taskType: "audio_generate",
        modalityContractKey: "voice_generation",
        limit: 24,
      });
    });
    await vi.waitFor(() => {
      expect(getMessages()[0]?.taskPreview).toMatchObject({
        kind: "audio_generate",
        status: "complete",
        audioUrl: ".lime/runtime/audio/task-audio-1.mp3",
        mimeType: "audio/mpeg",
        durationMs: 1800,
        providerId: "limecore",
        model: "voice-pro",
        statusMessage:
          "音频结果已同步，工作区已从 audio_output 读取可播放结果。",
      });
    });
    expect(getMediaTaskArtifact).not.toHaveBeenCalled();
  });

  it("应优先从统一媒体任务索引恢复 provider 失败且不保留旧音频路径", async () => {
    vi.mocked(listMediaTaskArtifacts).mockResolvedValueOnce(
      buildFailedAudioTaskIndex(),
    );
    const runningWithStaleAudioPath = buildRunningAudioMessage();
    if (runningWithStaleAudioPath.taskPreview?.kind === "audio_generate") {
      runningWithStaleAudioPath.taskPreview.audioUrl =
        ".lime/runtime/audio/stale.mp3";
    }
    const { render, getMessages } = renderHook({
      messages: [runningWithStaleAudioPath],
    });

    await render();

    await vi.waitFor(() => {
      expect(getMessages()[0]?.taskPreview).toMatchObject({
        kind: "audio_generate",
        status: "failed",
        audioUrl: null,
        providerId: "missing-provider",
        model: "voice-pro",
        errorCode: "audio_provider_unconfigured",
        retryable: true,
        statusMessage:
          "配音 Provider 未配置，请先在语音生成设置中选择可用 Provider；任务保留在 audio_generate，不会回退 legacy TTS。",
      });
    });
    expect(getMediaTaskArtifact).not.toHaveBeenCalled();
  });

  it("应从完成态 audio_generate task artifact 恢复可播放音频预览", async () => {
    vi.mocked(getMediaTaskArtifact).mockResolvedValueOnce(
      buildCompletedAudioArtifact(),
    );
    const { render, getMessages } = renderHook();

    await render();

    await vi.waitFor(() => {
      expect(getMediaTaskArtifact).toHaveBeenCalledWith({
        projectRootPath: "/workspace",
        taskRef: ".lime/tasks/audio_generate/task-audio-1.json",
      });
    });
    await vi.waitFor(() => {
      expect(getMessages()[0]?.taskPreview).toMatchObject({
        kind: "audio_generate",
        status: "complete",
        audioUrl: ".lime/runtime/audio/task-audio-1.mp3",
        mimeType: "audio/mpeg",
        durationMs: 1800,
        providerId: "limecore",
        model: "voice-pro",
        statusMessage:
          "音频结果已同步，工作区已从 audio_output 读取可播放结果。",
      });
    });
    expect(getMessages()[0]?.artifacts?.[0]).toMatchObject({
      title: "task-audio-1.md",
      status: "complete",
      meta: {
        taskId: "task-audio-1",
        taskType: "audio_generate",
        audioUrl: ".lime/runtime/audio/task-audio-1.mp3",
        artifactDocument: {
          status: "ready",
          metadata: {
            audioUrl: ".lime/runtime/audio/task-audio-1.mp3",
          },
        },
      },
    });
  });

  it("应从失败态 audio_generate task artifact 回流 provider 错误且不伪造音频路径", async () => {
    vi.mocked(getMediaTaskArtifact).mockResolvedValueOnce(
      buildFailedAudioArtifact(),
    );
    const { render, getMessages } = renderHook();

    await render();

    await vi.waitFor(() => {
      expect(getMessages()[0]?.taskPreview).toMatchObject({
        kind: "audio_generate",
        status: "failed",
        audioUrl: null,
        errorCode: "audio_provider_unconfigured",
        errorMessage:
          "未找到可用的 voice_generation provider/API Key: missing-provider。",
        retryable: true,
        statusMessage:
          "配音 Provider 未配置，请先在语音生成设置中选择可用 Provider；任务保留在 audio_generate，不会回退 legacy TTS。",
      });
    });
    expect(getMessages()[0]?.artifacts?.[0]).toMatchObject({
      title: "task-audio-1.md",
      status: "error",
      meta: {
        taskId: "task-audio-1",
        taskType: "audio_generate",
        audioUrl: null,
        errorCode: "audio_provider_unconfigured",
        artifactDocument: {
          status: "failed",
          metadata: {
            audioUrl: null,
            errorCode: "audio_provider_unconfigured",
          },
        },
      },
    });
    expect(
      JSON.stringify(getMessages()[0]?.artifacts?.[0]?.meta.artifactDocument),
    ).toContain("不会回退 legacy TTS");
  });
});
