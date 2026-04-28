import type { ResourceManagerItem, ResourceManagerKind } from "./types";

export type ResourceFormatPreviewTarget =
  | "webview"
  | "text"
  | "data"
  | "system"
  | "unsupported";

export interface ResourceFormatInfo {
  extension: string;
  kind: ResourceManagerKind;
  label: string;
  previewTarget: ResourceFormatPreviewTarget;
}

interface ResourceFormatGroup {
  extensions: string[];
  kind: ResourceManagerKind;
  label: string;
  previewTarget: ResourceFormatPreviewTarget;
}

const RESOURCE_FORMAT_GROUPS: ResourceFormatGroup[] = [
  {
    extensions: ["jpg", "jpeg", "jpe", "jfif"],
    kind: "image",
    label: "JPEG 图片",
    previewTarget: "webview",
  },
  {
    extensions: ["png", "apng"],
    kind: "image",
    label: "PNG 图片",
    previewTarget: "webview",
  },
  {
    extensions: ["gif"],
    kind: "image",
    label: "GIF 动图",
    previewTarget: "webview",
  },
  {
    extensions: ["webp"],
    kind: "image",
    label: "WebP 图片",
    previewTarget: "webview",
  },
  {
    extensions: ["svg", "svgz"],
    kind: "image",
    label: "SVG 矢量图",
    previewTarget: "webview",
  },
  {
    extensions: ["bmp", "dib", "ico", "cur", "avif"],
    kind: "image",
    label: "浏览器图片",
    previewTarget: "webview",
  },
  {
    extensions: [
      "jxl",
      "jp2",
      "j2k",
      "jpf",
      "icns",
      "tga",
      "dds",
      "exr",
      "hdr",
    ],
    kind: "image",
    label: "专业图片",
    previewTarget: "system",
  },
  {
    extensions: ["heic", "heif", "tif", "tiff"],
    kind: "image",
    label: "系统图片",
    previewTarget: "system",
  },
  {
    extensions: [
      "raw",
      "dng",
      "arw",
      "cr2",
      "cr3",
      "nef",
      "nrw",
      "orf",
      "raf",
      "rw2",
      "pef",
      "srw",
    ],
    kind: "image",
    label: "RAW 图片",
    previewTarget: "system",
  },
  {
    extensions: ["psd", "ai", "eps"],
    kind: "image",
    label: "设计源文件",
    previewTarget: "system",
  },
  {
    extensions: ["mp4", "m4v", "webm", "ogv"],
    kind: "video",
    label: "WebView 视频",
    previewTarget: "webview",
  },
  {
    extensions: [
      "mov",
      "avi",
      "mkv",
      "wmv",
      "flv",
      "mpg",
      "mpeg",
      "m2v",
      "mxf",
      "vob",
      "divx",
      "asf",
      "rm",
      "rmvb",
    ],
    kind: "video",
    label: "桌面视频",
    previewTarget: "system",
  },
  {
    extensions: ["3gp", "3g2", "ts", "mts", "m2ts"],
    kind: "video",
    label: "移动/摄像机视频",
    previewTarget: "system",
  },
  {
    extensions: [
      "mp3",
      "m4a",
      "m4b",
      "aac",
      "wav",
      "ogg",
      "oga",
      "opus",
      "flac",
      "weba",
    ],
    kind: "audio",
    label: "WebView 音频",
    previewTarget: "webview",
  },
  {
    extensions: [
      "aif",
      "aiff",
      "caf",
      "wma",
      "amr",
      "mid",
      "midi",
      "ape",
      "alac",
      "mka",
      "ac3",
      "dts",
    ],
    kind: "audio",
    label: "桌面音频",
    previewTarget: "system",
  },
  {
    extensions: ["pdf"],
    kind: "pdf",
    label: "PDF 文档",
    previewTarget: "webview",
  },
  {
    extensions: ["md", "markdown", "mdx", "mkd", "mdwn"],
    kind: "markdown",
    label: "Markdown 文稿",
    previewTarget: "text",
  },
  {
    extensions: [
      "txt",
      "log",
      "rtf",
      "rst",
      "adoc",
      "textile",
      "diff",
      "patch",
      "srt",
      "vtt",
      "ass",
      "ssa",
      "tex",
      "env",
      "ini",
      "conf",
      "cfg",
      "properties",
    ],
    kind: "text",
    label: "文本文件",
    previewTarget: "text",
  },
  {
    extensions: [
      "js",
      "jsx",
      "ts",
      "tsx",
      "css",
      "scss",
      "less",
      "html",
      "htm",
      "sql",
      "sh",
      "bash",
      "zsh",
      "fish",
      "ps1",
      "bat",
      "cmd",
      "py",
      "rb",
      "go",
      "rs",
      "java",
      "kt",
      "swift",
      "c",
      "h",
      "cpp",
      "hpp",
      "cs",
      "php",
      "lua",
      "vue",
      "svelte",
      "astro",
      "jsonc",
      "proto",
      "graphql",
      "gql",
    ],
    kind: "text",
    label: "源码文本",
    previewTarget: "text",
  },
  {
    extensions: ["json", "jsonl", "ndjson", "geojson", "har", "ipynb"],
    kind: "data",
    label: "JSON 数据",
    previewTarget: "data",
  },
  {
    extensions: ["csv", "tsv"],
    kind: "data",
    label: "表格数据",
    previewTarget: "data",
  },
  {
    extensions: ["xml", "yaml", "yml", "toml", "plist", "lock"],
    kind: "data",
    label: "结构化数据",
    previewTarget: "data",
  },
  {
    extensions: ["parquet", "feather", "arrow"],
    kind: "data",
    label: "二进制数据集",
    previewTarget: "unsupported",
  },
  {
    extensions: ["zip", "zipx", "7z", "rar", "cab"],
    kind: "archive",
    label: "压缩包",
    previewTarget: "system",
  },
  {
    extensions: [
      "tar",
      "gz",
      "tgz",
      "bz2",
      "tbz",
      "xz",
      "txz",
      "zst",
      "br",
      "lz",
      "lzma",
      "cpio",
      "xar",
    ],
    kind: "archive",
    label: "Unix 归档",
    previewTarget: "system",
  },
  {
    extensions: ["iso", "dmg", "img"],
    kind: "archive",
    label: "磁盘镜像",
    previewTarget: "system",
  },
  {
    extensions: ["doc", "docx", "docm", "dot", "dotx", "dotm"],
    kind: "office",
    label: "Word 文档",
    previewTarget: "system",
  },
  {
    extensions: ["xls", "xlsx", "xlsm", "xlsb", "xlt", "xltx", "xltm"],
    kind: "office",
    label: "Excel 表格",
    previewTarget: "system",
  },
  {
    extensions: [
      "ppt",
      "pptx",
      "pptm",
      "pps",
      "ppsx",
      "ppsm",
      "pot",
      "potx",
      "potm",
    ],
    kind: "office",
    label: "PowerPoint 幻灯片",
    previewTarget: "system",
  },
  {
    extensions: [
      "odt",
      "ott",
      "ods",
      "ots",
      "odp",
      "otp",
      "fodt",
      "fods",
      "fodp",
    ],
    kind: "office",
    label: "OpenDocument 文档",
    previewTarget: "system",
  },
  {
    extensions: ["pages"],
    kind: "office",
    label: "Pages 文稿",
    previewTarget: "system",
  },
  {
    extensions: ["numbers"],
    kind: "office",
    label: "Numbers 表格",
    previewTarget: "system",
  },
  {
    extensions: ["key"],
    kind: "office",
    label: "Keynote 幻灯片",
    previewTarget: "system",
  },
  {
    extensions: ["wps", "wpt"],
    kind: "office",
    label: "WPS 文字文档",
    previewTarget: "system",
  },
  {
    extensions: ["et", "ett"],
    kind: "office",
    label: "WPS 表格",
    previewTarget: "system",
  },
  {
    extensions: ["dps", "dpt"],
    kind: "office",
    label: "WPS 演示文稿",
    previewTarget: "system",
  },
];

const RESOURCE_FORMAT_BY_EXTENSION = new Map<string, ResourceFormatInfo>(
  RESOURCE_FORMAT_GROUPS.flatMap((group) =>
    group.extensions.map((extension) => [
      extension,
      {
        extension,
        kind: group.kind,
        label: group.label,
        previewTarget: group.previewTarget,
      },
    ]),
  ),
);

export function extractResourceExtension(
  ...values: Array<string | null | undefined>
): string {
  for (const value of values) {
    const normalized = value?.split(/[?#]/)[0]?.replace(/\\/g, "/").trim();
    if (!normalized) continue;
    const fileName = normalized.split("/").pop() || normalized;
    const dotIndex = fileName.lastIndexOf(".");
    if (dotIndex >= 0 && dotIndex < fileName.length - 1) {
      return fileName.slice(dotIndex + 1).toLowerCase();
    }
  }
  return "";
}

export function getResourceFormatInfo(params: {
  src?: string | null;
  filePath?: string | null;
  title?: string | null;
}): ResourceFormatInfo | null {
  const extension = extractResourceExtension(
    params.filePath,
    params.src,
    params.title,
  );
  return extension
    ? (RESOURCE_FORMAT_BY_EXTENSION.get(extension) ?? null)
    : null;
}

export function inferResourceKindFromMime(
  mimeType?: string | null,
): ResourceManagerKind | null {
  const normalized = mimeType?.toLowerCase().trim();
  if (!normalized) return null;
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("audio/")) return "audio";
  if (normalized === "application/pdf") return "pdf";
  if (normalized.includes("markdown")) return "markdown";
  if (
    normalized.includes("zip") ||
    normalized.includes("x-7z") ||
    normalized.includes("x-rar") ||
    normalized.includes("x-tar") ||
    normalized.includes("x-cpio") ||
    normalized.includes("x-xar") ||
    normalized.includes("gzip") ||
    normalized.includes("x-bzip") ||
    normalized.includes("x-xz") ||
    normalized.includes("x-lzma") ||
    normalized.includes("zstd") ||
    normalized.includes("vnd.ms-cab-compressed") ||
    normalized.includes("x-apple-diskimage") ||
    normalized.includes("x-iso9660-image")
  ) {
    return "archive";
  }
  if (
    normalized.includes("json") ||
    normalized.includes("xml") ||
    normalized.includes("yaml") ||
    normalized.includes("toml") ||
    normalized.includes("csv")
  ) {
    return "data";
  }
  if (
    normalized.includes("word") ||
    normalized.includes("excel") ||
    normalized.includes("powerpoint") ||
    normalized.includes("spreadsheet") ||
    normalized.includes("presentation") ||
    normalized.includes("officedocument") ||
    normalized.includes("opendocument") ||
    normalized.includes("msword") ||
    normalized.includes("wps-office") ||
    normalized.includes("keynote") ||
    normalized.includes("pages") ||
    normalized.includes("numbers")
  ) {
    return "office";
  }
  if (normalized.startsWith("text/")) return "text";
  return null;
}

function getResourceFormatLabelFromMime(
  mimeType?: string | null,
): string | null {
  const normalized = mimeType?.toLowerCase().trim();
  if (!normalized) return null;

  if (normalized.includes("heic") || normalized.includes("heif")) {
    return "系统图片";
  }
  if (normalized.includes("tiff")) return "系统图片";
  if (normalized.includes("svg")) return "SVG 矢量图";
  if (normalized.includes("avif")) return "浏览器图片";
  if (normalized.startsWith("image/")) return "图片文件";

  if (
    normalized.includes("quicktime") ||
    normalized.includes("x-matroska") ||
    normalized.includes("x-msvideo") ||
    normalized.includes("mp2t")
  ) {
    return "桌面视频";
  }
  if (normalized.startsWith("video/")) return "视频文件";

  if (
    normalized.includes("x-aiff") ||
    normalized.includes("x-ms-wma") ||
    normalized.includes("midi")
  ) {
    return "桌面音频";
  }
  if (normalized.startsWith("audio/")) return "音频文件";

  if (normalized === "application/pdf") return "PDF 文档";
  if (normalized.includes("markdown")) return "Markdown 文稿";
  if (normalized.includes("zip")) return "压缩包";
  if (normalized.includes("x-7z")) return "7z 压缩包";
  if (normalized.includes("x-rar")) return "RAR 压缩包";
  if (
    normalized.includes("x-tar") ||
    normalized.includes("x-cpio") ||
    normalized.includes("x-xar")
  ) {
    return "Unix 归档";
  }
  if (normalized.includes("vnd.ms-cab-compressed")) return "压缩包";
  if (
    normalized.includes("gzip") ||
    normalized.includes("x-bzip") ||
    normalized.includes("x-xz") ||
    normalized.includes("x-lzma") ||
    normalized.includes("zstd")
  ) {
    return "压缩归档";
  }
  if (
    normalized.includes("x-apple-diskimage") ||
    normalized.includes("x-iso9660-image")
  ) {
    return "磁盘镜像";
  }
  if (normalized.includes("parquet")) return "二进制数据集";
  if (normalized.includes("arrow") || normalized.includes("feather")) {
    return "二进制数据集";
  }
  if (normalized.includes("word") || normalized.includes("msword")) {
    return "Word 文档";
  }
  if (normalized.includes("spreadsheet") || normalized.includes("excel")) {
    return "Excel 表格";
  }
  if (
    normalized.includes("presentation") ||
    normalized.includes("powerpoint")
  ) {
    return "PowerPoint 幻灯片";
  }
  if (normalized.includes("opendocument")) return "OpenDocument 文档";
  if (normalized.includes("keynote")) return "Keynote 幻灯片";
  if (normalized.includes("pages")) return "Pages 文稿";
  if (normalized.includes("numbers")) return "Numbers 表格";
  if (normalized.includes("wps-office")) return "WPS 文档";
  if (
    normalized.includes("json") ||
    normalized.includes("xml") ||
    normalized.includes("yaml") ||
    normalized.includes("toml") ||
    normalized.includes("csv")
  ) {
    return "结构化数据";
  }
  if (normalized.startsWith("text/")) return "文本文件";
  return null;
}

function getResourcePreviewTargetFromMime(
  mimeType?: string | null,
): ResourceFormatPreviewTarget | null {
  const normalized = mimeType?.toLowerCase().trim();
  if (!normalized) return null;

  if (normalized.includes("heic") || normalized.includes("heif")) {
    return "system";
  }
  if (normalized.includes("tiff")) return "system";
  if (
    normalized.startsWith("image/") &&
    !normalized.includes("jpeg") &&
    !normalized.includes("png") &&
    !normalized.includes("gif") &&
    !normalized.includes("webp") &&
    !normalized.includes("svg") &&
    !normalized.includes("bmp") &&
    !normalized.includes("x-icon") &&
    !normalized.includes("avif")
  ) {
    return "system";
  }

  if (
    normalized.includes("quicktime") ||
    normalized.includes("x-matroska") ||
    normalized.includes("x-msvideo") ||
    normalized.includes("x-ms-wmv") ||
    normalized.includes("mp2t") ||
    normalized.includes("mpeg")
  ) {
    return "system";
  }
  if (
    normalized.startsWith("video/") &&
    !normalized.includes("mp4") &&
    !normalized.includes("webm") &&
    !normalized.includes("ogg")
  ) {
    return "system";
  }

  if (
    normalized.includes("x-aiff") ||
    normalized.includes("x-ms-wma") ||
    normalized.includes("midi") ||
    normalized.includes("amr")
  ) {
    return "system";
  }
  if (
    normalized.startsWith("audio/") &&
    !normalized.includes("mpeg") &&
    !normalized.includes("mp4") &&
    !normalized.includes("aac") &&
    !normalized.includes("wav") &&
    !normalized.includes("ogg") &&
    !normalized.includes("flac") &&
    !normalized.includes("opus")
  ) {
    return "system";
  }

  if (normalized === "application/pdf") return "webview";
  if (normalized.includes("markdown")) return "text";
  if (
    normalized.includes("zip") ||
    normalized.includes("x-7z") ||
    normalized.includes("x-rar") ||
    normalized.includes("x-tar") ||
    normalized.includes("x-cpio") ||
    normalized.includes("x-xar") ||
    normalized.includes("gzip") ||
    normalized.includes("x-bzip") ||
    normalized.includes("x-xz") ||
    normalized.includes("x-lzma") ||
    normalized.includes("zstd") ||
    normalized.includes("vnd.ms-cab-compressed") ||
    normalized.includes("x-apple-diskimage") ||
    normalized.includes("x-iso9660-image")
  ) {
    return "system";
  }
  if (normalized.includes("parquet")) return "unsupported";
  if (normalized.includes("arrow") || normalized.includes("feather")) {
    return "unsupported";
  }
  if (
    normalized.includes("json") ||
    normalized.includes("xml") ||
    normalized.includes("yaml") ||
    normalized.includes("toml") ||
    normalized.includes("csv")
  ) {
    return "data";
  }
  if (
    normalized.includes("word") ||
    normalized.includes("excel") ||
    normalized.includes("powerpoint") ||
    normalized.includes("spreadsheet") ||
    normalized.includes("presentation") ||
    normalized.includes("officedocument") ||
    normalized.includes("opendocument") ||
    normalized.includes("msword") ||
    normalized.includes("wps-office") ||
    normalized.includes("keynote") ||
    normalized.includes("pages") ||
    normalized.includes("numbers")
  ) {
    return "system";
  }
  if (normalized.startsWith("text/")) return "text";
  return null;
}

export function getResourceFormatLabel(
  item: Pick<ResourceManagerItem, "src" | "filePath" | "title" | "mimeType">,
): string | null {
  const format = getResourceFormatInfo(item);
  if (format) return format.label;

  const mimeLabel = getResourceFormatLabelFromMime(item.mimeType);
  if (mimeLabel) return mimeLabel;

  const mimeKind = inferResourceKindFromMime(item.mimeType);
  if (mimeKind === "image") return "图片文件";
  if (mimeKind === "video") return "视频文件";
  if (mimeKind === "audio") return "音频文件";
  if (mimeKind === "pdf") return "PDF 文档";
  if (mimeKind === "markdown") return "Markdown 文稿";
  if (mimeKind === "office") return "Office 文档";
  if (mimeKind === "data") return "结构化数据";
  if (mimeKind === "archive") return "归档文件";
  if (mimeKind === "text") return "文本文件";
  return null;
}

export function getResourcePreviewTarget(
  item: Pick<
    ResourceManagerItem,
    "kind" | "src" | "filePath" | "title" | "mimeType"
  >,
): ResourceFormatPreviewTarget {
  const format = getResourceFormatInfo(item);
  if (format) return format.previewTarget;

  const mimeTarget = getResourcePreviewTargetFromMime(item.mimeType);
  if (mimeTarget) return mimeTarget;

  if (item.kind === "text" || item.kind === "markdown") return "text";
  if (item.kind === "data") return "data";
  if (item.kind === "office") return "system";
  if (item.kind === "archive") return "system";
  if (item.kind === "unknown") return "unsupported";
  return "webview";
}

export function getResourcePreviewTargetLabel(
  item: Pick<
    ResourceManagerItem,
    "kind" | "src" | "filePath" | "title" | "mimeType"
  >,
): string {
  const target = getResourcePreviewTarget(item);
  if (target === "webview") return "WebView 原生";
  if (target === "text") return "文本预览";
  if (target === "data") return "结构化预览";
  if (target === "system") return "系统应用更稳";
  return "需要专用解析器";
}
