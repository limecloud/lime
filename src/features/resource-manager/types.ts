export type ResourceManagerKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "text"
  | "markdown"
  | "office"
  | "data"
  | "archive"
  | "unknown";

export type ResourceManagerSourceContextKind =
  | "chat"
  | "image_task"
  | "project_resource"
  | "browser_saved_content"
  | "local_file"
  | "external";

export interface ResourceManagerSourceContext {
  kind: ResourceManagerSourceContextKind;
  projectId?: string | null;
  contentId?: string | null;
  taskId?: string | null;
  outputId?: string | null;
  messageId?: string | null;
  threadId?: string | null;
  artifactId?: string | null;
  originUrl?: string | null;
  markdownRelativePath?: string | null;
  sourcePage?: string | null;
  resourceFolderId?: string | null;
  resourceCategory?: string | null;
}

export type ResourceManagerMetadataValue =
  | string
  | number
  | boolean
  | null
  | undefined;

export interface ResourceManagerItemMetadata {
  prompt?: string | null;
  slotLabel?: string | null;
  size?: string | number | null;
  providerName?: string | null;
  modelName?: string | null;
  width?: number | null;
  height?: number | null;
  sourceType?: string | null;
  mimeType?: string | null;
  projectId?: string | null;
  [key: string]: ResourceManagerMetadataValue;
}

export interface ResourceManagerItem {
  id: string;
  kind: ResourceManagerKind;
  src?: string | null;
  filePath?: string | null;
  title?: string | null;
  description?: string | null;
  content?: string | null;
  mimeType?: string | null;
  size?: number | null;
  metadata?: ResourceManagerItemMetadata;
  sourceContext?: ResourceManagerSourceContext | null;
}

export interface ResourceManagerItemInput extends Omit<
  ResourceManagerItem,
  "id" | "kind" | "src"
> {
  id?: string | null;
  kind?: ResourceManagerKind | null;
  src?: string | null;
  filePath?: string | null;
}

export interface ResourceManagerSession {
  id: string;
  items: ResourceManagerItem[];
  initialIndex: number;
  sourceLabel?: string | null;
  sourceContext?: ResourceManagerSourceContext | null;
  createdAt: number;
}

export interface OpenResourceManagerInput {
  items: ResourceManagerItemInput[];
  initialIndex?: number;
  sourceLabel?: string | null;
  sourceContext?: ResourceManagerSourceContext | null;
}
