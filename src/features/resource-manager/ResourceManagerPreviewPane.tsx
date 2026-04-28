import { ArchiveResourceRenderer } from "./ArchiveResourceRenderer";
import { DataResourceRenderer } from "./DataResourceRenderer";
import { ImageResourceRenderer } from "./ImageResourceRenderer";
import type { ImageResourceViewControls } from "./imageResourceViewControls";
import { MediaPlaybackResourceRenderer } from "./MediaPlaybackResourceRenderer";
import { OfficeResourceRenderer } from "./OfficeResourceRenderer";
import { PdfResourceRenderer } from "./PdfResourceRenderer";
import { getResourcePreviewTarget } from "./resourceFormatCatalog";
import {
  getItemDescription,
  getShortcutHint,
} from "./resourceManagerPresentation";
import { SystemDelegatedResourceRenderer } from "./SystemDelegatedResourceRenderer";
import { TextResourceRenderer } from "./TextResourceRenderer";
import { UnsupportedResourceRenderer } from "./UnsupportedResourceRenderer";
import type { ResourceManagerItem } from "./types";

interface ResourceManagerPreviewPaneProps {
  item: ResourceManagerItem;
  imageControls: ImageResourceViewControls;
  metadataChips: string[];
  hasMultipleItems: boolean;
  previewSearchQuery: string;
  previewSearchActiveIndex: number;
  markdownViewMode: "preview" | "source";
  dataViewMode: "formatted" | "raw";
  onPrevious: () => void;
  onNext: () => void;
  onSearchMatchCountChange: (matchCount: number) => void;
}

export function ResourceManagerPreviewPane({
  item,
  imageControls,
  metadataChips,
  hasMultipleItems,
  previewSearchQuery,
  previewSearchActiveIndex,
  markdownViewMode,
  dataViewMode,
  onPrevious,
  onNext,
  onSearchMatchCountChange,
}: ResourceManagerPreviewPaneProps) {
  const description = getItemDescription(item);
  const previewTarget = getResourcePreviewTarget(item);

  return (
    <div className="relative flex min-w-0 flex-1">
      {item.kind === "image" && previewTarget === "webview" ? (
        <ImageResourceRenderer
          item={item}
          controls={imageControls}
          hasPrevious={hasMultipleItems}
          hasNext={hasMultipleItems}
          onPrevious={onPrevious}
          onNext={onNext}
        />
      ) : item.kind === "image" ? (
        <SystemDelegatedResourceRenderer item={item} />
      ) : (item.kind === "video" || item.kind === "audio") &&
        previewTarget === "webview" ? (
        <MediaPlaybackResourceRenderer item={item} />
      ) : item.kind === "video" || item.kind === "audio" ? (
        <SystemDelegatedResourceRenderer item={item} />
      ) : item.kind === "pdf" ? (
        <PdfResourceRenderer item={item} />
      ) : item.kind === "text" || item.kind === "markdown" ? (
        <TextResourceRenderer
          item={item}
          searchQuery={previewSearchQuery}
          activeSearchMatchIndex={previewSearchActiveIndex}
          markdownViewMode={markdownViewMode}
          onSearchMatchCountChange={onSearchMatchCountChange}
        />
      ) : item.kind === "data" && previewTarget === "data" ? (
        <DataResourceRenderer
          item={item}
          searchQuery={previewSearchQuery}
          activeSearchMatchIndex={previewSearchActiveIndex}
          viewMode={dataViewMode}
          onSearchMatchCountChange={onSearchMatchCountChange}
        />
      ) : item.kind === "data" ? (
        <SystemDelegatedResourceRenderer item={item} />
      ) : item.kind === "office" ? (
        <OfficeResourceRenderer item={item} />
      ) : item.kind === "archive" ? (
        <ArchiveResourceRenderer item={item} />
      ) : (
        <UnsupportedResourceRenderer item={item} />
      )}

      <footer className="pointer-events-none absolute bottom-3 left-3 z-20 flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-2 text-xs text-slate-500">
        {metadataChips.map((chip) => (
          <span
            key={chip}
            className="rounded-full bg-white/90 px-2.5 py-1 shadow-sm shadow-slate-950/5"
          >
            {chip}
          </span>
        ))}
        {item.filePath ? (
          <span className="max-w-[40rem] truncate rounded-full bg-white/90 px-2.5 py-1 shadow-sm shadow-slate-950/5">
            {item.filePath}
          </span>
        ) : null}
        {description ? (
          <span className="max-w-[24rem] truncate rounded-full bg-white/90 px-2.5 py-1 shadow-sm shadow-slate-950/5">
            {description}
          </span>
        ) : null}
        <span className="hidden rounded-full bg-white/90 px-2.5 py-1 text-slate-400 shadow-sm shadow-slate-950/5 xl:inline">
          {getShortcutHint(item)}
        </span>
      </footer>
    </div>
  );
}
