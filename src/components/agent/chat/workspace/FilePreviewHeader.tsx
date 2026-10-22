import type { ReactNode } from "react";
import { Download, LoaderCircle } from "lucide-react";

export interface FilePreviewDownloadAction {
  label: string;
  busy: boolean;
  onSelect(): Promise<void>;
}

export function FilePreviewHeader({
  title,
  download,
  children,
}: {
  title: string;
  download?: FilePreviewDownloadAction;
  children?: ReactNode;
}) {
  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
        {title}
      </span>
      {children}
      {download ? (
        <button
          type="button"
          aria-label={download.label}
          title={download.label}
          aria-busy={download.busy}
          disabled={download.busy}
          onClick={() => void download.onSelect()}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {download.busy ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      ) : null}
    </header>
  );
}
