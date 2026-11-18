import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Chrome,
  Figma,
  FileText,
  FolderOpen,
  GitCompare,
  Search,
  SquareTerminal,
} from "lucide-react";
import { toast } from "sonner";
import { openExternalUrlWithSystemBrowser } from "@/lib/api/externalUrl";
import { pickFilesFromDialog } from "@/lib/api/filePicker";
import { openIn } from "@/lib/api/openIn";
import { searchProjectFiles } from "@/lib/api/fuzzyFileSearch";
import { importChromeBrowserHistory } from "@/lib/api/browserHistory";
import { importChromeBrowserCookies } from "@/lib/api/browserCookies";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TerminalTab } from "../../components/TerminalTab";

type HomeNewTabView = "home" | "terminal" | "changes";

export function HomeNewTabSurface({
  workspaceRoot,
}: {
  workspaceRoot?: string | null;
}) {
  const { t } = useTranslation("agent");
  const [view, setView] = useState<HomeNewTabView>("home");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ path: string; name: string }>>(
    [],
  );
  const [searching, setSearching] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [terminalSessionId] = useState(
    () => `home-terminal-${crypto.randomUUID()}`,
  );
  const [changesSessionId] = useState(
    () => `home-changes-${crypto.randomUUID()}`,
  );

  const submit = async () => {
    const value = query.trim();
    if (!value) return;
    if (/^(https?:\/\/|www\.)/i.test(value)) {
      void openExternalUrlWithSystemBrowser(
        value.startsWith("www.") ? `https://${value}` : value,
      );
      return;
    }
    if (!workspaceRoot) {
      toast.info(t("agentChat.homeNewTab.selectProjectForFiles"));
      return;
    }
    setSearching(true);
    try {
      const files = await searchProjectFiles({
        query: value,
        rootPath: workspaceRoot,
        cancellationToken: crypto.randomUUID(),
      });
      setResults(
        files.map((file) => ({ path: file.path, name: file.file_name })),
      );
    } catch {
      toast.error(t("agentChat.homeNewTab.fileSearchFailed"));
    } finally {
      setSearching(false);
    }
  };

  const openFile = async (path: string) => {
    try {
      await openIn.open({ path, target: "systemDefault", openMode: "file" });
    } catch {
      toast.error(t("agentChat.homeNewTab.openFileFailed"));
    }
  };

  if (view === "terminal") {
    return (
      <TerminalTab
        cwd={workspaceRoot}
        sessionId={terminalSessionId}
        active
        onNewTerminalTab={() => setView("home")}
      />
    );
  }

  if (view === "changes") {
    return (
      <TerminalTab
        cwd={workspaceRoot}
        command="git diff --stat && git status --short"
        sessionId={changesSessionId}
        active
        onNewTerminalTab={() => setView("home")}
      />
    );
  }

  const actions = [
    {
      id: "terminal",
      label: t("agentChat.homeNewTab.terminal"),
      icon: SquareTerminal,
      onClick: () => setView("terminal"),
    },
    {
      id: "changes",
      label: t("agentChat.homeNewTab.changes"),
      icon: GitCompare,
      onClick: () => setView("changes"),
    },
    {
      id: "figma",
      label: t("agentChat.homeNewTab.figma"),
      icon: Figma,
      onClick: () =>
        void openExternalUrlWithSystemBrowser("https://www.figma.com/"),
    },
    {
      id: "files",
      label: t("agentChat.homeNewTab.files"),
      icon: FolderOpen,
      onClick: async () => {
        const paths = await pickFilesFromDialog({
          title: t("agentChat.homeNewTab.files"),
        });
        const picked = paths?.[0];
        if (!picked) return;
        await openIn.open({
          path: picked.fsPath || picked.path,
          target: "systemDefault",
          openMode: "file",
        });
      },
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-[color:var(--lime-surface)] px-6 py-4">
      <button
        type="button"
        className="flex w-full items-center gap-3 rounded-lg border border-[color:var(--lime-surface-border)] px-3 py-2.5 text-left hover:bg-[color:var(--lime-surface-hover)]"
        onClick={() => setImportOpen(true)}
        disabled={importing}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[color:var(--lime-surface-hover)] text-base">
          <Chrome size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium">
            {t("agentChat.homeNewTab.importChrome")}
          </span>
          <span className="block text-xs text-[color:var(--lime-text-muted)]">
            {importing
              ? t("agentChat.homeNewTab.importing")
              : t("agentChat.homeNewTab.importChromeDescription")}
          </span>
        </span>
        <span className="rounded-full bg-[color:var(--lime-text-strong)] px-3 py-1 text-xs text-[color:var(--lime-surface)]">
          {importing
            ? t("agentChat.homeNewTab.importingAction")
            : t("agentChat.homeNewTab.importAction")}
        </span>
      </button>

      <div className="mt-8 flex items-center gap-2 rounded-full border border-[color:var(--lime-surface-border)] px-3 py-2">
        <Search size={15} className="shrink-0 text-[color:var(--lime-text-muted)]" />
        <input
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[color:var(--lime-text-muted)]"
          placeholder={t("agentChat.homeNewTab.searchPlaceholder")}
          aria-label={t("agentChat.homeNewTab.searchPlaceholder")}
        />
      </div>

      {searching ? (
        <p className="mt-3 text-xs text-[color:var(--lime-text-muted)]">
          {t("agentChat.homeNewTab.searching")}
        </p>
      ) : null}
      {results.length > 0 ? (
        <div className="mt-3 flex max-h-[180px] flex-col gap-1 overflow-auto">
          {results.map((file) => (
            <button
              key={file.path}
              type="button"
              onClick={() => void openFile(file.path)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[color:var(--lime-surface-hover)]"
            >
              <FileText size={14} className="shrink-0" />
              <span className="min-w-0 truncate">{file.path}</span>
            </button>
          ))}
        </div>
      ) : null}

      <h2 className="mt-7 text-xs font-medium text-[color:var(--lime-text-muted)]">
        {t("agentChat.homeNewTab.new")}
      </h2>
      <div className="mt-2 grid grid-cols-2 gap-3">
        {actions.map(({ id, label, icon: Icon, onClick }) => (
          <button
            key={id}
            type="button"
            onClick={() => void onClick()}
            className="flex h-[92px] flex-col items-start justify-between rounded-xl bg-[color:var(--lime-surface-hover)] p-3 text-left hover:bg-[color:var(--lime-surface-active)]"
            data-testid={`home-new-tab-${id}`}
          >
            <Icon size={18} />
            <span className="text-[13px] font-medium">{label}</span>
          </button>
        ))}
      </div>
      <ConfirmDialog
        isOpen={importOpen}
        title={t("agentChat.homeNewTab.importChrome")}
        message={t("agentChat.homeNewTab.importChromeConfirm")}
        confirmText={t("agentChat.homeNewTab.importAction")}
        cancelText={t("common:common.cancel")}
        onCancel={() => setImportOpen(false)}
        onConfirm={() => {
          setImportOpen(false);
          if (importing) return;
          setImporting(true);
          void Promise.all([
            importChromeBrowserHistory(),
            importChromeBrowserCookies(),
          ])
            .then(([history, cookies]) => {
              toast.success(
                t("agentChat.homeNewTab.importChromeSuccess", {
                  history: history.imported,
                  cookies: cookies.imported,
                }),
              );
            })
            .catch(() => toast.error(t("agentChat.homeNewTab.importChromeFailed")))
            .finally(() => setImporting(false));
        }}
      />
    </div>
  );
}
