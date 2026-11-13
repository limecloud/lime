import licensesText from "../../../../LICENSES.md?raw";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function SourceLicensesDialog({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  closeLabel: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[720px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <pre className="max-h-[56vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 p-4 text-[12px] leading-5 text-foreground">
          {licensesText}
        </pre>
        <div className="flex justify-end">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-[13px]"
            onClick={() => onOpenChange(false)}
          >
            {closeLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
