import { cn } from "@/lib/utils";

export const A2UI_LAYOUT_TOKENS = {
  flexBase: "flex",
  rowDirection: "flex-row",
  columnDirection: "flex-col",
  cardShell:
    "a2ui-card-shell rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm",
  dividerBase: "bg-border",
  dividerHorizontal: "h-px w-full",
  dividerVertical: "w-px h-full min-h-[20px]",
} as const;

const JUSTIFY_CLASS_MAP: Record<string, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  spaceBetween: "justify-between",
  spaceAround: "justify-around",
  spaceEvenly: "justify-evenly",
  stretch: "justify-stretch",
};

const ALIGN_CLASS_MAP: Record<string, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};

export function getA2UILayoutClasses(options: {
  direction: "row" | "column";
  justify?: string;
  align?: string;
  defaultAlign?: "start" | "stretch";
}) {
  return cn(
    A2UI_LAYOUT_TOKENS.flexBase,
    options.direction === "row"
      ? A2UI_LAYOUT_TOKENS.rowDirection
      : A2UI_LAYOUT_TOKENS.columnDirection,
    JUSTIFY_CLASS_MAP[options.justify || "start"],
    ALIGN_CLASS_MAP[options.align || options.defaultAlign || "stretch"],
  );
}

export default A2UI_LAYOUT_TOKENS;
