import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolCallState } from "@/lib/api/agentStream";
import { ToolCallDisplay } from "./ToolCallDisplay";

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedHarness[] = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
});

function render(toolCall: ToolCallState): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <ToolCallDisplay
        toolCall={toolCall}
        defaultExpanded
        isMessageStreaming
      />,
    );
  });

  mountedRoots.push({ container, root });
  return container;
}

describe("ToolCallDisplay", () => {
  it("工具结果包含图片时应渲染缩略图预览", () => {
    const toolCall: ToolCallState = {
      id: "tool-image-1",
      name: "Read",
      status: "completed",
      startTime: new Date(),
      endTime: new Date(),
      result: {
        success: true,
        output: "图片已生成",
        images: [
          { src: "data:image/png;base64,aGVsbG8=", mimeType: "image/png" },
        ],
      },
    };

    const container = render(toolCall);
    const previewImage = container.querySelector(
      'img[alt="工具结果图片预览"]',
    ) as HTMLImageElement | null;
    expect(previewImage).not.toBeNull();
    expect(previewImage?.src).toContain("data:image/png;base64,aGVsbG8=");
  });

  it("点击缩略图后应显示大图预览层", () => {
    const toolCall: ToolCallState = {
      id: "tool-image-2",
      name: "Read",
      status: "completed",
      startTime: new Date(),
      endTime: new Date(),
      result: {
        success: true,
        output: "图片已生成",
        images: [
          { src: "data:image/png;base64,aGVsbG8=", mimeType: "image/png" },
        ],
      },
    };

    const container = render(toolCall);
    const thumbnail = container.querySelector(
      'img[alt="工具结果图片预览"]',
    ) as HTMLImageElement | null;
    expect(thumbnail).not.toBeNull();

    act(() => {
      thumbnail?.click();
    });

    const enlargedImage = document.querySelector(
      'img[alt="工具结果图片大图"]',
    ) as HTMLImageElement | null;
    expect(enlargedImage).not.toBeNull();
  });

  it("工具结果包含 metadata 时应渲染执行摘要", () => {
    const toolCall: ToolCallState = {
      id: "tool-meta-1",
      name: "Bash",
      status: "failed",
      startTime: new Date(),
      endTime: new Date(),
      result: {
        success: false,
        output: "命令执行失败",
        metadata: {
          exit_code: 1,
          stdout_length: 120,
          stderr_length: 32,
          sandboxed: true,
          output_file: "/tmp/aster_tasks/task-1.log",
        },
      },
    };

    const container = render(toolCall);
    expect(container.textContent).toContain("退出码 1");
    expect(container.textContent).toContain("stdout 120");
    expect(container.textContent).toContain("已隔离执行");
    expect(container.textContent).toContain(
      "输出文件: /tmp/aster_tasks/task-1.log",
    );
  });

  it("工具结果完成 offload 转存时应显示转存摘要与文件路径", () => {
    const toolCall: ToolCallState = {
      id: "tool-offload-1",
      name: "Write",
      status: "completed",
      startTime: new Date(),
      endTime: new Date(),
      result: {
        success: true,
        output:
          "preview line\n\n[ProxyCast Offload] 完整输出已转存到文件：/tmp/proxycast/harness/tool-io/results/tool-offload-1.json",
        metadata: {
          proxycast_offloaded: true,
          offload_file:
            "/tmp/proxycast/harness/tool-io/results/tool-offload-1.json",
          offload_original_chars: 18234,
          offload_original_tokens: 4521,
          offload_trigger: "token_limit_before_evict",
        },
      },
    };

    const container = render(toolCall);
    expect(container.textContent).toContain("完整输出已转存");
    expect(container.textContent).toContain("原始 18234 字符");
    expect(container.textContent).toContain("约 4521 tokens");
    expect(container.textContent).toContain("token 阈值触发");
    expect(container.textContent).toContain(
      "转存文件: /tmp/proxycast/harness/tool-io/results/tool-offload-1.json",
    );
  });
});
