import {
  FileSpreadsheet,
  FileText,
  Presentation,
  type LucideProps,
} from "lucide-react";
import type { ForwardRefExoticComponent, RefAttributes } from "react";
import { extractResourceExtension } from "./resourceFormatCatalog";
import type { ResourceManagerItem } from "./types";

type ResourceDocumentProfileIcon = ForwardRefExoticComponent<
  Omit<LucideProps, "ref"> & RefAttributes<SVGSVGElement>
>;

export interface ResourceDocumentProfile {
  key: string;
  toolbarLabel: string;
  titleLabel: string;
  nativeAppLabel: string;
  statusLabel: string;
  Icon: ResourceDocumentProfileIcon;
  iconClassName: string;
  iconBoxClassName: string;
}

interface ResourceDocumentProfileGroup {
  extensions: string[];
  profile: ResourceDocumentProfile;
}

const WORD_PROFILE: ResourceDocumentProfile = {
  key: "word",
  toolbarLabel: "Word",
  titleLabel: "Word 文档",
  nativeAppLabel: "Word / WPS 文字",
  statusLabel: "系统文档处理",
  Icon: FileText,
  iconClassName: "text-sky-600",
  iconBoxClassName: "border-sky-200 bg-sky-50 text-sky-600",
};

const SPREADSHEET_PROFILE: ResourceDocumentProfile = {
  key: "spreadsheet",
  toolbarLabel: "Excel",
  titleLabel: "Excel 表格",
  nativeAppLabel: "Excel / Numbers / WPS 表格",
  statusLabel: "系统表格处理",
  Icon: FileSpreadsheet,
  iconClassName: "text-emerald-600",
  iconBoxClassName: "border-emerald-200 bg-emerald-50 text-emerald-600",
};

const PRESENTATION_PROFILE: ResourceDocumentProfile = {
  key: "presentation",
  toolbarLabel: "PowerPoint",
  titleLabel: "PowerPoint 幻灯片",
  nativeAppLabel: "PowerPoint / Keynote / WPS 演示",
  statusLabel: "系统演示处理",
  Icon: Presentation,
  iconClassName: "text-orange-600",
  iconBoxClassName: "border-orange-200 bg-orange-50 text-orange-600",
};

const OPEN_DOCUMENT_PROFILE: ResourceDocumentProfile = {
  key: "open-document",
  toolbarLabel: "OpenDocument",
  titleLabel: "OpenDocument 文档",
  nativeAppLabel: "LibreOffice / OpenOffice",
  statusLabel: "系统文档处理",
  Icon: FileText,
  iconClassName: "text-cyan-600",
  iconBoxClassName: "border-cyan-200 bg-cyan-50 text-cyan-600",
};

const IWORK_DOCUMENT_PROFILE: ResourceDocumentProfile = {
  key: "iwork-document",
  toolbarLabel: "Pages",
  titleLabel: "Pages 文稿",
  nativeAppLabel: "Pages",
  statusLabel: "Pages 打开",
  Icon: FileText,
  iconClassName: "text-indigo-600",
  iconBoxClassName: "border-indigo-200 bg-indigo-50 text-indigo-600",
};

const IWORK_SPREADSHEET_PROFILE: ResourceDocumentProfile = {
  key: "iwork-spreadsheet",
  toolbarLabel: "Numbers",
  titleLabel: "Numbers 表格",
  nativeAppLabel: "Numbers",
  statusLabel: "Numbers 打开",
  Icon: FileSpreadsheet,
  iconClassName: "text-emerald-600",
  iconBoxClassName: "border-emerald-200 bg-emerald-50 text-emerald-600",
};

const IWORK_PRESENTATION_PROFILE: ResourceDocumentProfile = {
  key: "iwork-presentation",
  toolbarLabel: "Keynote",
  titleLabel: "Keynote 幻灯片",
  nativeAppLabel: "Keynote",
  statusLabel: "Keynote 打开",
  Icon: Presentation,
  iconClassName: "text-orange-600",
  iconBoxClassName: "border-orange-200 bg-orange-50 text-orange-600",
};

const WPS_WRITER_PROFILE: ResourceDocumentProfile = {
  key: "wps-writer",
  toolbarLabel: "WPS 文字",
  titleLabel: "WPS 文字文档",
  nativeAppLabel: "WPS 文字",
  statusLabel: "WPS 文字处理",
  Icon: FileText,
  iconClassName: "text-rose-600",
  iconBoxClassName: "border-rose-200 bg-rose-50 text-rose-600",
};

const WPS_SPREADSHEET_PROFILE: ResourceDocumentProfile = {
  key: "wps-spreadsheet",
  toolbarLabel: "WPS 表格",
  titleLabel: "WPS 表格",
  nativeAppLabel: "WPS 表格",
  statusLabel: "WPS 表格处理",
  Icon: FileSpreadsheet,
  iconClassName: "text-emerald-600",
  iconBoxClassName: "border-emerald-200 bg-emerald-50 text-emerald-600",
};

const WPS_PRESENTATION_PROFILE: ResourceDocumentProfile = {
  key: "wps-presentation",
  toolbarLabel: "WPS 演示",
  titleLabel: "WPS 演示文稿",
  nativeAppLabel: "WPS 演示",
  statusLabel: "WPS 演示处理",
  Icon: Presentation,
  iconClassName: "text-orange-600",
  iconBoxClassName: "border-orange-200 bg-orange-50 text-orange-600",
};

const GENERIC_DOCUMENT_PROFILE: ResourceDocumentProfile = {
  key: "generic-document",
  toolbarLabel: "文档",
  titleLabel: "文档文件",
  nativeAppLabel: "本机文档应用",
  statusLabel: "系统文档处理",
  Icon: FileText,
  iconClassName: "text-slate-600",
  iconBoxClassName: "border-slate-200 bg-slate-50 text-slate-600",
};

const DOCUMENT_PROFILE_GROUPS: ResourceDocumentProfileGroup[] = [
  {
    extensions: ["doc", "docx", "docm", "dot", "dotx", "dotm"],
    profile: WORD_PROFILE,
  },
  {
    extensions: ["xls", "xlsx", "xlsm", "xlsb", "xlt", "xltx", "xltm"],
    profile: SPREADSHEET_PROFILE,
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
    profile: PRESENTATION_PROFILE,
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
    profile: OPEN_DOCUMENT_PROFILE,
  },
  {
    extensions: ["pages"],
    profile: IWORK_DOCUMENT_PROFILE,
  },
  {
    extensions: ["numbers"],
    profile: IWORK_SPREADSHEET_PROFILE,
  },
  {
    extensions: ["key"],
    profile: IWORK_PRESENTATION_PROFILE,
  },
  {
    extensions: ["wps", "wpt"],
    profile: WPS_WRITER_PROFILE,
  },
  {
    extensions: ["et", "ett"],
    profile: WPS_SPREADSHEET_PROFILE,
  },
  {
    extensions: ["dps", "dpt"],
    profile: WPS_PRESENTATION_PROFILE,
  },
];

const DOCUMENT_PROFILE_BY_EXTENSION = new Map<string, ResourceDocumentProfile>(
  DOCUMENT_PROFILE_GROUPS.flatMap((group) =>
    group.extensions.map((extension) => [extension, group.profile]),
  ),
);

function getDocumentProfileFromMime(
  mimeType?: string | null,
): ResourceDocumentProfile | null {
  const normalized = mimeType?.toLowerCase().trim();
  if (!normalized) return null;

  if (
    normalized.includes("presentation") ||
    normalized.includes("powerpoint")
  ) {
    return PRESENTATION_PROFILE;
  }
  if (normalized.includes("spreadsheet") || normalized.includes("excel")) {
    return SPREADSHEET_PROFILE;
  }
  if (normalized.includes("word") || normalized.includes("msword")) {
    return WORD_PROFILE;
  }
  if (normalized.includes("opendocument")) {
    return OPEN_DOCUMENT_PROFILE;
  }
  if (normalized.includes("keynote")) return IWORK_PRESENTATION_PROFILE;
  if (normalized.includes("numbers")) return IWORK_SPREADSHEET_PROFILE;
  if (normalized.includes("pages")) return IWORK_DOCUMENT_PROFILE;
  if (normalized.includes("wps-office")) return WPS_WRITER_PROFILE;
  return null;
}

export function getResourceDocumentProfile(
  item: Pick<ResourceManagerItem, "src" | "filePath" | "title" | "mimeType">,
): ResourceDocumentProfile {
  const extension = extractResourceExtension(
    item.filePath,
    item.src,
    item.title,
  );
  return (
    (extension ? DOCUMENT_PROFILE_BY_EXTENSION.get(extension) : null) ??
    getDocumentProfileFromMime(item.mimeType) ??
    GENERIC_DOCUMENT_PROFILE
  );
}
