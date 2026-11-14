import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Globe,
  Presentation,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { isReducedMotionPreferred } from "@/lib/appearance/reducedMotion";
import type { ThreadOutput } from "./threadOutputs";
import { outputFileName } from "./threadOutputPaths";
import { websiteOutputName } from "./threadOutputWebsite";
import styles from "./ThreadSidePanelRecents.module.css";

function fileIcon(path: string) {
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (["avif", "gif", "jpeg", "jpg", "png", "webp"].includes(extension ?? ""))
    return FileImage;
  if (["csv", "tsv", "xls", "xlsm", "xlsx"].includes(extension ?? ""))
    return FileSpreadsheet;
  if (["ppt", "pptx"].includes(extension ?? "")) return Presentation;
  return ["doc", "docx", "pdf", "md", "mdx", "tex"].includes(extension ?? "")
    ? FileText
    : File;
}

export function ThreadSidePanelRecents({
  outputs,
  onOpen,
}: {
  outputs: readonly ThreadOutput[];
  onOpen: (output: ThreadOutput, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const { t, i18n } = useTranslation("agent");
  const sectionRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [size, setSize] = useState({ height: 336, row: 56 });
  const [scroll, setScroll] = useState({ previous: false, next: false });
  const [interacted, setInteracted] = useState(false);
  useEffect(() => {
    const list = listRef.current;
    const section = sectionRef.current;
    const root = section?.closest<HTMLElement>("[data-new-tab-scroll-root]");
    if (!list || !section || !root) return;
    const update = () => {
      const row =
        (list.firstElementChild as HTMLElement | null)?.offsetHeight || 56;
      const rootRect = root.getBoundingClientRect();
      const scale =
        root.offsetHeight > 0 ? rootRect.height / root.offsetHeight : 1;
      const top =
        (list.getBoundingClientRect().top - rootRect.top) / (scale || 1) +
        root.scrollTop;
      const padding =
        Number.parseFloat(getComputedStyle(root).paddingBottom) || 0;
      const rows = Math.max(
        2,
        Math.floor((root.clientHeight - top - padding - row / 2) / row),
      );
      const height = Math.min(6, rows + 0.5) * row;
      setSize((current) =>
        current.height === height && current.row === row
          ? current
          : { height, row },
      );
      const previous = list.scrollTop >= 1;
      const next = list.scrollTop + list.clientHeight < list.scrollHeight - 1;
      setScroll((current) =>
        current.previous === previous && current.next === next
          ? current
          : { previous, next },
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(root);
    if (root.firstElementChild) observer.observe(root.firstElementChild);
    observer.observe(list);
    if (list.firstElementChild) observer.observe(list.firstElementChild);
    list.addEventListener("scroll", update);
    update();
    return () => {
      observer.disconnect();
      list.removeEventListener("scroll", update);
    };
  }, [outputs]);
  if (!outputs.length) return null;
  const page = (direction: number) => {
    setInteracted(true);
    const list = listRef.current;
    if (!list) return;
    const rows = Math.max(
      1,
      Math.floor((list.clientHeight - size.row / 2) / size.row),
    );
    list.scrollBy({
      top: direction * rows * size.row,
      behavior: isReducedMotionPreferred() ? "instant" : "smooth",
    });
  };
  const locale = i18n.resolvedLanguage || i18n.language;
  const now = new Date();
  return (
    <section
      ref={sectionRef}
      className="flex min-w-0 flex-col gap-3"
      data-testid="thread-side-panel-recents"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-[color:var(--lime-text)]">
          {t("agentChat.rightSurface.newTab.recents")}
        </h3>
        <div className="flex gap-1">
          {([-1, 1] as const).map((direction) => {
            const Icon = direction === -1 ? ChevronUp : ChevronDown;
            return (
              <button
                key={direction}
                type="button"
                disabled={direction === -1 ? !scroll.previous : !scroll.next}
                className="flex size-7 items-center justify-center rounded-lg text-[color:var(--lime-text-muted)] outline-none hover:bg-[color:var(--lime-chrome-tab-hover)] focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                aria-label={t(
                  `agentChat.rightSurface.newTab.${direction === -1 ? "previousRecents" : "nextRecents"}`,
                )}
                onClick={() => page(direction)}
              >
                <Icon size={16} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>
      <ul
        ref={listRef}
        aria-label={t("agentChat.rightSurface.newTab.recentWork")}
        className={`${styles.list} min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain`}
        data-at-bottom={!scroll.next}
        data-interacted={interacted}
        onWheel={() => setInteracted(true)}
        onTouchStart={() => setInteracted(true)}
        onKeyDown={() => setInteracted(true)}
        style={
          {
            maxHeight: size.height,
            "--recent-row-height": `${size.row}px`,
          } as CSSProperties
        }
      >
        {outputs.map((file) => {
          const target = file.type === "website" ? file.target : file.path;
          const name =
            file.type === "website"
              ? websiteOutputName(target)
              : outputFileName(target);
          const Icon =
            file.type === "website"
              ? Globe
              : file.type === "generated-image"
                ? FileImage
                : fileIcon(file.path);
          const date =
            file.producedAtMs === undefined
              ? null
              : new Date(file.producedAtMs);
          const valid = date !== null && Number.isFinite(date.getTime());
          const today = valid && date.toDateString() === now.toDateString();
          return (
            <li
              key={`${file.type === "website" ? "website" : "file"}:${target}`}
              className={styles.row}
            >
              <button
                type="button"
                onClick={(event) => onOpen(file, event)}
                onAuxClick={(event) => {
                  if (
                    event.button === 1 &&
                    file.type === "website" &&
                    /^https?:\/\//i.test(file.target)
                  )
                    onOpen(file, event);
                }}
                title={target}
                aria-label={name}
                className="flex min-h-14 w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-[color:var(--lime-text)] outline-none hover:bg-[color:var(--lime-chrome-tab-hover)] focus-visible:bg-[color:var(--lime-chrome-tab-hover)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[color:var(--lime-chrome-tab-hover)] text-[color:var(--lime-text-muted)]">
                  <Icon size={16} aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate">{name}</span>
                  <span className="truncate text-xs text-[color:var(--lime-text-muted)]">
                    {t(
                      `agentChat.rightSurface.newTab.fileType.${file.type === "website" ? "website" : Icon === FileImage ? "image" : Icon === FileSpreadsheet ? "spreadsheet" : Icon === Presentation ? "presentation" : file.path.toLowerCase().endsWith(".pdf") ? "pdf" : Icon === FileText ? "document" : "other"}`,
                    )}
                  </span>
                </span>
                {valid ? (
                  <time
                    className="shrink-0 whitespace-nowrap text-xs text-[color:var(--lime-text-muted)] tabular-nums"
                    dateTime={date.toISOString()}
                    title={new Intl.DateTimeFormat(locale, {
                      dateStyle: "full",
                      timeStyle: "long",
                    }).format(date)}
                  >
                    {new Intl.DateTimeFormat(
                      locale,
                      today
                        ? { hour: "numeric", minute: "2-digit" }
                        : {
                            month: "short",
                            day: "numeric",
                            ...(date.getFullYear() === now.getFullYear()
                              ? {}
                              : { year: "numeric" }),
                          },
                    ).format(date)}
                  </time>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
