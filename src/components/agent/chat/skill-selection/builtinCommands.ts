export interface BuiltinInputCommand {
  key:
    | "image"
    | "cover_generate"
    | "image_edit"
    | "image_variation"
    | "video_generate"
    | "transcription_generate"
    | "url_parse";
  label: string;
  mentionLabel: string;
  commandPrefix: string;
  description: string;
  aliases: string[];
}

export const INPUTBAR_BUILTIN_COMMANDS: BuiltinInputCommand[] = [
  {
    key: "image",
    label: "配图",
    mentionLabel: "配图",
    commandPrefix: "@配图",
    description: "根据文字描述生成新的图片结果",
    aliases: ["image", "img", "图片", "生图"],
  },
  {
    key: "cover_generate",
    label: "封面",
    mentionLabel: "封面",
    commandPrefix: "@封面",
    description: "根据主题生成平台封面图任务",
    aliases: ["cover", "fengmian", "封面", "封面图", "头图"],
  },
  {
    key: "image_edit",
    label: "修图",
    mentionLabel: "修图",
    commandPrefix: "@修图",
    description: "编辑已有图片并生成新的结果图",
    aliases: ["edit", "xiutu", "修图", "改图", "图片编辑"],
  },
  {
    key: "image_variation",
    label: "重绘",
    mentionLabel: "重绘",
    commandPrefix: "@重绘",
    description: "基于已有图片或参考图继续重绘新的结果图",
    aliases: ["variation", "variant", "zhonghui", "重绘", "图片重绘", "变体"],
  },
  {
    key: "video_generate",
    label: "视频",
    mentionLabel: "视频",
    commandPrefix: "@视频",
    description: "根据文字描述提交视频生成任务",
    aliases: ["video", "shipin", "视频", "短视频", "生成视频"],
  },
  {
    key: "transcription_generate",
    label: "转写",
    mentionLabel: "转写",
    commandPrefix: "@转写",
    description: "把音频或视频来源提交为转写任务",
    aliases: ["transcribe", "zhuanxie", "转写", "逐字稿", "字幕", "语音转文字"],
  },
  {
    key: "url_parse",
    label: "链接解析",
    mentionLabel: "链接解析",
    commandPrefix: "@链接解析",
    description: "解析网页链接并提交为可追踪的文本任务",
    aliases: [
      "url",
      "url_parse",
      "链接",
      "链接解析",
      "网页读取",
      "网页解析",
    ],
  },
];

export function filterBuiltinCommands(query: string): BuiltinInputCommand[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return INPUTBAR_BUILTIN_COMMANDS;
  }

  return INPUTBAR_BUILTIN_COMMANDS.filter((command) => {
    const haystacks = [
      command.label,
      command.mentionLabel,
      command.commandPrefix,
      command.description,
      ...command.aliases,
    ];
    return haystacks.some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    );
  });
}
