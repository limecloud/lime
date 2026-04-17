import { useState, ReactNode } from "react";
import { ChevronDown, ChevronUp, HelpCircle } from "lucide-react";

interface HelpTipProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  variant?: "blue" | "amber" | "green";
}

export function HelpTip({
  title,
  children,
  defaultOpen = false,
  variant = "blue",
}: HelpTipProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const variantStyles = {
    blue: {
      border: "border-emerald-200 dark:border-emerald-900",
      bg: "bg-emerald-50 dark:bg-emerald-950/30",
      title: "text-emerald-800 dark:text-emerald-300",
      icon: "text-emerald-600 dark:text-emerald-400",
    },
    amber: {
      border: "border-amber-200 dark:border-amber-900",
      bg: "bg-amber-50 dark:bg-amber-950/30",
      title: "text-amber-800 dark:text-amber-300",
      icon: "text-amber-600 dark:text-amber-400",
    },
    green: {
      border: "border-green-200 dark:border-green-900",
      bg: "bg-green-50 dark:bg-green-950/30",
      title: "text-green-800 dark:text-green-300",
      icon: "text-green-600 dark:text-green-400",
    },
  };

  const styles = variantStyles[variant];

  return (
    <div className={`rounded-lg border ${styles.border} ${styles.bg} mb-2`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between p-3 text-left"
      >
        <div className="flex items-center gap-2">
          <HelpCircle className={`h-4 w-4 ${styles.icon}`} />
          <span className={`text-sm font-medium ${styles.title}`}>{title}</span>
        </div>
        {isOpen ? (
          <ChevronUp className={`h-4 w-4 ${styles.icon}`} />
        ) : (
          <ChevronDown className={`h-4 w-4 ${styles.icon}`} />
        )}
      </button>
      {isOpen && <div className="px-3 pb-4 pt-1">{children}</div>}
    </div>
  );
}
