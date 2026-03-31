export const A2UI_TASK_CARD_TOKENS = {
  shell:
    "overflow-hidden rounded-[24px] border border-slate-200/90 bg-background/95 shadow-[0_14px_40px_rgba(15,23,42,0.08)]",
  shellEmbedded:
    "overflow-visible rounded-none border-0 bg-transparent shadow-none",
  shellCompactPadding: "p-4",
  shellDefaultPadding: "my-3 p-5",
  shellEmbeddedPadding: "p-0",
  statusBadge:
    "flex shrink-0 items-center gap-2 rounded-full border border-slate-200/90 bg-slate-50/92 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm shadow-slate-950/5",
  contentPanel: "mt-4 rounded-[20px] border border-slate-200 bg-slate-50/70",
  contentPanelEmbedded:
    "mt-3 rounded-[18px] border border-slate-200/90 bg-slate-50/88",
  contentPanelCompactPadding: "p-4",
  contentPanelDefaultPadding: "p-5",
  contentPanelEmbeddedCompactPadding: "p-3",
  contentPanelEmbeddedDefaultPadding: "p-4",
  loadingPanel:
    "mt-4 flex items-center gap-3 rounded-[20px] border border-slate-200 bg-slate-50/70 text-slate-500",
  loadingPanelCompactPadding: "px-4 py-3 text-xs",
  loadingPanelDefaultPadding: "px-5 py-4 text-sm",
  workspaceOverlay:
    "pointer-events-auto w-full max-w-[820px] rounded-[28px] border border-slate-200/90 bg-background/98 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.16)]",
  workspaceSection:
    "mt-5 rounded-[24px] border border-slate-200 bg-slate-50/70 p-5",
  workspaceDock:
    "flex w-full max-w-[640px] items-center justify-between gap-4 rounded-2xl border border-slate-200/90 bg-background/96 px-5 py-3.5 text-left shadow-[0_8px_30px_rgba(15,23,42,0.12)] backdrop-blur transition hover:border-blue-200 hover:shadow-[0_12px_36px_rgba(15,23,42,0.14)]",
} as const;

export default A2UI_TASK_CARD_TOKENS;
