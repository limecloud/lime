import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DeveloperPanelMessage {
  type: "success" | "error";
  text: string;
}

export const SECONDARY_BUTTON_CLASS_NAME =
  "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50";

export const DANGER_BUTTON_CLASS_NAME =
  "inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50";

export function DeveloperInlineMessage({
  message,
}: {
  message: DeveloperPanelMessage;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-[18px] border px-4 py-3 text-sm shadow-sm shadow-slate-950/5",
        message.type === "success"
          ? "border-emerald-200 bg-emerald-50/90 text-emerald-700"
          : "border-rose-200 bg-rose-50/90 text-rose-700",
      )}
    >
      <AlertCircle className="h-4 w-4" />
      <span>{message.text}</span>
    </div>
  );
}
