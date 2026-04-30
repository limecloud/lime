import { describe, expect, it } from "vitest";
import {
  buildImageTaskPreviewFromToolResult,
  buildTaskPreviewFromToolResult,
  buildToolResultArtifactFromToolResult,
} from "./taskPreviewFromToolResult";

describe("buildImageTaskPreviewFromToolResult", () => {
  it("应在图片任务完成后输出更友好的完成态摘要", () => {
    const preview = buildImageTaskPreviewFromToolResult({
      toolId: "tool-1",
      toolName: "Bash",
      toolArguments: JSON.stringify({
        command: 'lime media image generate --prompt "未来感青柠实验室"',
      }),
      toolResult: {
        metadata: {
          task_id: "task-1",
          task_type: "image_generate",
          status: "succeeded",
          prompt: "未来感青柠实验室",
          size: "1024x1024",
          project_id: "project-1",
          content_id: "content-1",
          path: "/tmp/task-1.json",
          artifact_path: ".lime/tasks/image_generate/task-1.json",
          requested_count: 2,
          received_count: 2,
        },
      },
      fallbackPrompt: "@配图 未来感青柠实验室",
    });

    expect(preview).toMatchObject({
      taskId: "task-1",
      prompt: "未来感青柠实验室",
      status: "complete",
      imageCount: 2,
      size: "1024x1024",
      projectId: "project-1",
      contentId: "content-1",
      taskFilePath: "/tmp/task-1.json",
      artifactPath: ".lime/tasks/image_generate/task-1.json",
      phase: "succeeded",
      statusMessage: "图片已生成完成，共 2 张。",
    });
  });

  it("应在图片任务失败时输出失败态摘要", () => {
    const preview = buildImageTaskPreviewFromToolResult({
      toolId: "tool-2",
      toolName: "Bash",
      toolArguments: JSON.stringify({
        command: 'lime media image generate --prompt "未来感青柠实验室"',
      }),
      toolResult: {
        metadata: {
          task_id: "task-2",
          task_type: "image_generate",
          status: "failed",
        },
      },
      fallbackPrompt: "@配图 未来感青柠实验室",
    });

    expect(preview).toMatchObject({
      taskId: "task-2",
      status: "failed",
      phase: "failed",
      statusMessage: "图片任务执行失败，请查看工具结果或任务详情。",
    });
  });

  it("图片任务完成但尚未带回数量时，应输出面向用户的完成态文案", () => {
    const preview = buildImageTaskPreviewFromToolResult({
      toolId: "tool-3",
      toolName: "Bash",
      toolArguments: JSON.stringify({
        command: 'lime media image generate --prompt "清晨广州塔"',
      }),
      toolResult: {
        metadata: {
          task_id: "task-3",
          task_type: "image_generate",
          status: "succeeded",
          prompt: "清晨广州塔",
          size: "1024x1024",
        },
      },
      fallbackPrompt: "@配图 清晨广州塔",
    });

    expect(preview).toMatchObject({
      taskId: "task-3",
      status: "complete",
      phase: "succeeded",
      statusMessage: "图片结果已生成完成，可在右侧查看与使用。",
    });
  });

  it("图片任务刚提交时，应输出用户可理解的排队态文案", () => {
    const preview = buildImageTaskPreviewFromToolResult({
      toolId: "tool-4",
      toolName: "Bash",
      toolArguments: JSON.stringify({
        command: 'lime media image generate --prompt "广州塔夜景"',
      }),
      toolResult: {
        metadata: {
          task_id: "task-4",
          task_type: "image_generate",
          status: "queued",
          prompt: "广州塔夜景",
        },
      },
      fallbackPrompt: "@配图 广州塔夜景",
    });

    expect(preview).toMatchObject({
      taskId: "task-4",
      status: "running",
      phase: "queued",
      statusMessage: "图片任务已提交，正在排队处理。",
    });
  });

  it("3x3 分镜完成后应输出更贴近布局语义的摘要", () => {
    const preview = buildImageTaskPreviewFromToolResult({
      toolId: "tool-5",
      toolName: "Bash",
      toolArguments: JSON.stringify({
        command:
          'lime media image generate --prompt "三国主要人物" --layout-hint storyboard_3x3',
      }),
      toolResult: {
        metadata: {
          task_id: "task-5",
          task_type: "image_generate",
          status: "succeeded",
          prompt: "三国主要人物",
          requested_count: 9,
          received_count: 9,
          layout_hint: "storyboard_3x3",
        },
      },
      fallbackPrompt: "@分镜 生成 三国主要人物，3x3 分镜",
    });

    expect(preview).toMatchObject({
      taskId: "task-5",
      status: "complete",
      imageCount: 9,
      layoutHint: "storyboard_3x3",
      statusMessage: "3x3 分镜已生成完成，共 9 张。",
    });
  });
});

describe("buildTaskPreviewFromToolResult video", () => {
  it("视频任务完成但尚未带回结果地址时，应输出完成态同步文案", () => {
    const preview = buildTaskPreviewFromToolResult({
      toolId: "tool-video-1",
      toolName: "Bash",
      toolArguments: JSON.stringify({
        command:
          'lime media video generate --prompt "广州塔城市宣传片" --duration 15 --aspect-ratio 16:9 --resolution 720p',
      }),
      toolResult: {
        metadata: {
          task_id: "task-video-1",
          task_type: "video_generate",
          status: "succeeded",
          prompt: "广州塔城市宣传片",
        },
      },
      fallbackPrompt: "@视频 15秒 广州塔城市宣传片，16:9，720p",
    });

    expect(preview).toMatchObject({
      kind: "video_generate",
      taskId: "task-video-1",
      status: "complete",
      phase: "succeeded",
      statusMessage: "视频已经生成完成，正在同步最终结果。",
    });
  });

  it("视频任务排队中时，应输出用户可理解的排队态文案", () => {
    const preview = buildTaskPreviewFromToolResult({
      toolId: "tool-video-2",
      toolName: "Bash",
      toolArguments: JSON.stringify({
        command:
          'lime media video generate --prompt "新品发布短视频" --duration 15 --aspect-ratio 16:9 --resolution 720p',
      }),
      toolResult: {
        metadata: {
          task_id: "task-video-2",
          task_type: "video_generate",
          status: "queued",
          prompt: "新品发布短视频",
        },
      },
      fallbackPrompt: "@视频 15秒 新品发布短视频，16:9，720p",
    });

    expect(preview).toMatchObject({
      kind: "video_generate",
      taskId: "task-video-2",
      status: "running",
      phase: "queued",
      statusMessage: "视频任务已进入排队队列，稍后会自动开始生成。",
    });
  });
});

describe("buildTaskPreviewFromToolResult audio", () => {
  it("配音任务应输出 audio_generate 预览并指向可打开的运行时文档", () => {
    const preview = buildTaskPreviewFromToolResult({
      toolId: "tool-audio-1",
      toolName: "lime_create_audio_generation_task",
      toolArguments: JSON.stringify({
        sourceText: "欢迎来到 Lime 多模态工作台。",
        voice: "warm_female",
        voiceStyle: "温暖克制",
        targetLanguage: "zh-CN",
        durationMs: 8200,
      }),
      toolResult: {
        metadata: {
          task_id: "task-audio-1",
          task_type: "audio_generate",
          status: "pending_submit",
          prompt: "欢迎来到 Lime 多模态工作台。",
          artifact_path: ".lime/tasks/audio_generate/task-audio-1.json",
          provider_id: "voice-runtime",
          model: "voice-pro",
        },
      },
      fallbackPrompt: "@配音 欢迎来到 Lime 多模态工作台。",
    });

    expect(preview).toMatchObject({
      kind: "audio_generate",
      taskId: "task-audio-1",
      taskType: "audio_generate",
      prompt: "欢迎来到 Lime 多模态工作台。",
      status: "running",
      phase: "queued",
      artifactPath: ".lime/runtime/audio-generate/task-audio-1.md",
      taskFilePath: ".lime/tasks/audio_generate/task-audio-1.json",
      providerId: "voice-runtime",
      model: "voice-pro",
      voice: "warm_female",
      durationMs: 8200,
      metaItems: ["warm_female", "温暖克制", "zh-CN", "8 秒"],
      statusMessage:
        "配音任务已写入 audio_task/audio_output，工作区会继续同步音频结果。",
    });
  });

  describe("buildTaskPreviewFromToolResult transcription", () => {
    it("转写任务应输出 transcription_generate 预览并指向运行时文档", () => {
      const preview = buildTaskPreviewFromToolResult({
        toolId: "tool-transcription-1",
        toolName: "lime_create_transcription_task",
        toolArguments: JSON.stringify({
          prompt: "请转写访谈音频",
          sourcePath: "materials/interview.wav",
          language: "zh-CN",
          outputFormat: "txt",
        }),
        toolResult: {
          metadata: {
            task_id: "task-transcription-1",
            task_type: "transcription_generate",
            status: "pending_submit",
            prompt: "请转写访谈音频",
            artifact_path:
              ".lime/tasks/transcription_generate/task-transcription-1.json",
            provider_id: "openai-asr",
            model: "gpt-4o-transcribe",
          },
        },
        fallbackPrompt: "@转写 materials/interview.wav",
      });

      expect(preview).toMatchObject({
        kind: "transcription_generate",
        taskId: "task-transcription-1",
        taskType: "transcription_generate",
        prompt: "请转写访谈音频",
        status: "running",
        phase: "queued",
        artifactPath:
          ".lime/runtime/transcription-generate/task-transcription-1.md",
        taskFilePath:
          ".lime/tasks/transcription_generate/task-transcription-1.json",
        sourcePath: "materials/interview.wav",
        language: "zh-CN",
        outputFormat: "txt",
        providerId: "openai-asr",
        model: "gpt-4o-transcribe",
        metaItems: ["materials/interview.wav", "zh-CN", "txt"],
        statusMessage: "转写任务已提交，工作区会继续同步最新进度。",
      });
    });

    it("转写任务工具结果应生成 transcript viewer 文档，避免打开隐藏 task json", () => {
      const artifact = buildToolResultArtifactFromToolResult({
        toolId: "tool-transcription-2",
        toolName: "lime_create_transcription_task",
        toolArguments: JSON.stringify({
          prompt: "请转写访谈音频",
          sourcePath: "materials/interview.wav",
          language: "zh-CN",
          outputFormat: "txt",
        }),
        toolResult: {
          metadata: {
            task_id: "task-transcription-2",
            task_type: "transcription_generate",
            status: "succeeded",
            artifact_path:
              ".lime/tasks/transcription_generate/task-transcription-2.json",
            transcript_path:
              ".lime/runtime/transcripts/task-transcription-2.txt",
            transcript_text: "欢迎来到 Lime 访谈节目。",
            transcript_segments: [
              {
                start: 1,
                end: 3.2,
                speaker: "主持人",
                text: "欢迎来到 Lime 访谈节目。",
              },
            ],
          },
        },
        fallbackPrompt: "@转写 materials/interview.wav",
      });

      expect(artifact).toMatchObject({
        filePath:
          ".lime/runtime/transcription-generate/task-transcription-2.md",
        metadata: {
          artifact_type: "document",
          taskId: "task-transcription-2",
          taskType: "transcription_generate",
          taskFilePath:
            ".lime/tasks/transcription_generate/task-transcription-2.json",
          transcriptPath: ".lime/runtime/transcripts/task-transcription-2.txt",
          transcriptText: "欢迎来到 Lime 访谈节目。",
          modalityContractKey: "audio_transcription",
        },
      });
      expect(artifact?.metadata.artifactDocument).toMatchObject({
        artifactId: "transcription-generate:task-transcription-2",
        title: "内容转写任务",
        metadata: {
          taskFilePath:
            ".lime/tasks/transcription_generate/task-transcription-2.json",
          transcriptPath: ".lime/runtime/transcripts/task-transcription-2.txt",
          transcriptText: "欢迎来到 Lime 访谈节目。",
          transcriptCorrectionEnabled: true,
          transcriptCorrectionStatus: "available",
          transcriptCorrectionSource: "artifact_document_version",
          transcriptCorrectionPatchKind: "artifact_document_version",
          transcriptCorrectionOriginalImmutable: true,
          transcriptSegments: [
            {
              id: "segment-1",
              index: 1,
              startMs: 1000,
              endMs: 3200,
              speaker: "主持人",
              text: "欢迎来到 Lime 访谈节目。",
            },
          ],
        },
      });
      expect(artifact?.metadata.artifactDocument).toMatchObject({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            id: "transcript-segments",
            type: "table",
            title: "转写时间轴（可逐段编辑校对）",
            rows: [["00:01 - 00:03", "主持人", "欢迎来到 Lime 访谈节目。"]],
          }),
          expect.objectContaining({
            id: "transcript-text",
            type: "code_block",
            title: "转写文本（可编辑校对）",
            code: "欢迎来到 Lime 访谈节目。",
          }),
          expect.objectContaining({
            id: "transcript-output",
            type: "callout",
            title: "Transcript 已同步，可校对保存",
            body: expect.stringContaining("不改写原始 ASR 输出"),
          }),
        ]),
      });
    });
  });

  it("配音任务工具结果应生成轻量 artifact document，避免打开隐藏 task json", () => {
    const artifact = buildToolResultArtifactFromToolResult({
      toolId: "tool-audio-2",
      toolName: "lime_create_audio_generation_task",
      toolArguments: JSON.stringify({
        sourceText: "请用轻快语气播报新品发布。",
        voice: "brand_voice",
        audioPath: "https://cdn.example/audio/task-audio-2.mp3",
      }),
      toolResult: {
        metadata: {
          task_id: "task-audio-2",
          task_type: "audio_generate",
          status: "succeeded",
          artifact_path: ".lime/tasks/audio_generate/task-audio-2.json",
          mime_type: "audio/mpeg",
        },
      },
      fallbackPrompt: "@配音 请用轻快语气播报新品发布。",
    });

    expect(artifact).toMatchObject({
      filePath: ".lime/runtime/audio-generate/task-audio-2.md",
      metadata: {
        artifact_type: "document",
        taskId: "task-audio-2",
        taskType: "audio_generate",
        taskFilePath: ".lime/tasks/audio_generate/task-audio-2.json",
        audioUrl: "https://cdn.example/audio/task-audio-2.mp3",
        modalityContractKey: "voice_generation",
      },
    });
    expect(artifact?.metadata.artifactDocument).toMatchObject({
      artifactId: "audio-generate:task-audio-2",
      title: "配音生成任务",
      metadata: {
        taskFilePath: ".lime/tasks/audio_generate/task-audio-2.json",
        audioUrl: "https://cdn.example/audio/task-audio-2.mp3",
      },
    });
  });
});
