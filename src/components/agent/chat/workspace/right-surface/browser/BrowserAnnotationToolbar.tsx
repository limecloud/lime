import { ArrowUp, Eye, EyeOff, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BrowserTabState } from "@/lib/api/browserTab";
import { browserIconButton } from "./BrowserNavigationBar";
import { useBrowserAnnotationToolbar } from "./useBrowserAnnotationToolbar";
import { BrowserAnnotationOriginalButton } from "./BrowserAnnotationOriginalButton";

function primaryPressed(event: { metaKey: boolean; ctrlKey: boolean }) {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    ? event.metaKey
    : event.ctrlKey;
}

export function BrowserAnnotationToolbar({
  selected,
  active,
  onExit,
  onAddToComposer,
  suspended = false,
  addModifierPressed = false,
  onError,
}: {
  selected: BrowserTabState | null;
  active: boolean;
  onExit: () => Promise<void>;
  onAddToComposer?: () => Promise<void>;
  suspended?: boolean;
  addModifierPressed?: boolean;
  onError: (error: unknown) => void;
}) {
  const { t } = useTranslation("agent");
  const toolbar = useBrowserAnnotationToolbar({ selected, active, onError });
  const [rendererModifier, setRendererModifier] = useState(false);
  const [originalFailure, setOriginalFailure] = useState(false);
  useEffect(() => {
    setRendererModifier(false);
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      if (event.isTrusted) setRendererModifier(primaryPressed(event));
    };
    const blur = () => setRendererModifier(false);
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", key, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", key, true);
      window.removeEventListener("blur", blur);
    };
  }, [active, selected?.tabId, selected?.viewId]);
  const adding = Boolean(
    onAddToComposer && (rendererModifier || addModifierPressed),
  );
  const label = (key: string) => String(t(`browserAnnotation.${key}` as never));
  const sendLabel = label(
    toolbar.operation === "send"
      ? "sending"
      : adding
        ? "addToComposer"
        : "sendAll",
  );
  const disabled = !active || Boolean(toolbar.operation) || toolbar.pending;
  return (
    <div
      className="shrink-0 border-b border-[color:var(--lime-surface-border)] px-2 py-1"
      data-testid="browser-annotation-toolbar"
    >
      <div
        role="toolbar"
        aria-label={label("title")}
        className="grid min-h-8 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2"
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={browserIconButton}
            aria-label={label("exit")}
            title={label("exit")}
            disabled={!active}
            onClick={() => void onExit().catch(onError)}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={browserIconButton}
            aria-label={label("discardAll")}
            title={label("discardAll")}
            aria-haspopup="dialog"
            aria-expanded={toolbar.confirming}
            disabled={disabled || !toolbar.hasDrafts}
            onClick={(event) =>
              void toolbar.discard(event.currentTarget).catch(onError)
            }
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </button>
        </div>
        <span
          className="truncate text-center text-xs text-[color:var(--lime-text-muted)]"
          aria-live="polite"
          title={selected?.url}
        >
          {label(suspended ? "browsing" : "annotating")}
          {selected?.url ? ` · ${selected.url}` : ""}
        </span>
        <div className="flex items-center gap-1">
          <span
            className="hidden text-xs text-[color:var(--lime-text-muted)] xl:inline"
            title={label(suspended ? "releaseSpace" : "holdSpace")}
          >
            {label(suspended ? "releaseSpace" : "holdSpace")}
          </span>
          <BrowserAnnotationOriginalButton
            selected={selected}
            disabled={disabled || !toolbar.hasDesign}
            label={label("original")}
            hint={label("holdOriginal")}
            onFailure={setOriginalFailure}
            onError={onError}
          />
          <button
            type="button"
            className={browserIconButton}
            aria-label={label(
              toolbar.markersVisible ? "hideMarkers" : "showMarkers",
            )}
            title={label(
              toolbar.markersVisible ? "hideMarkers" : "showMarkers",
            )}
            aria-pressed={toolbar.markersVisible}
            disabled={disabled}
            onClick={() => void toolbar.toggleMarkers()}
          >
            {toolbar.markersVisible ? (
              <Eye className="size-4" aria-hidden="true" />
            ) : (
              <EyeOff className="size-4" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[color:var(--lime-text-strong)] px-3 text-xs text-[color:var(--lime-surface)] disabled:opacity-35"
            aria-label={sendLabel}
            title={sendLabel}
            disabled={disabled || !toolbar.count}
            onClick={(event) => {
              const add =
                onAddToComposer &&
                (primaryPressed(event) || (event.detail === 0 && adding));
              if (add) void onAddToComposer().catch(onError);
              else void toolbar.send();
            }}
          >
            {sendLabel}
            <span
              aria-label={String(
                t(
                  "browserAnnotation.count" as never,
                  { count: toolbar.count } as never,
                ),
              )}
            >
              {toolbar.count}
            </span>
            <ArrowUp className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
      {toolbar.failure || originalFailure ? (
        <p role="alert" className="px-1 py-1 text-xs text-destructive">
          {label(toolbar.failure ?? "originalFailed")}
        </p>
      ) : null}
    </div>
  );
}
