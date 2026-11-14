import { useEffect } from "react";

function markdownForMessages(messages: readonly unknown[]): string {
  return messages
    .map((message) => {
      if (!message || typeof message !== "object") return "";
      const record = message as Record<string, unknown>;
      const role = typeof record.role === "string" ? record.role : "message";
      const content = record.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .map((part) => {
                  if (typeof part === "string") return part;
                  if (part && typeof part === "object" && "text" in part) {
                    const value = (part as { text?: unknown }).text;
                    return typeof value === "string" ? value : "";
                  }
                  return "";
                })
                .join("")
            : "";
      return text.trim() ? `## ${role}\n\n${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

export function WorkspaceShortcutRuntime({
  cwd,
  messages,
}: {
  cwd?: string | null;
  messages?: readonly unknown[];
}) {
  useEffect(() => {
    const workingDirectory = cwd?.trim();
    if (!workingDirectory) return;
    const copy = () => {
      void navigator.clipboard?.writeText(workingDirectory);
    };
    window.addEventListener("lime:copy-working-directory", copy);
    return () =>
      window.removeEventListener("lime:copy-working-directory", copy);
  }, [cwd]);
  useEffect(() => {
    if (!messages) return;
    const copy = () => {
      const markdown = markdownForMessages(messages);
      if (markdown) void navigator.clipboard?.writeText(markdown);
    };
    window.addEventListener("lime:copy-conversation-markdown", copy);
    return () =>
      window.removeEventListener("lime:copy-conversation-markdown", copy);
  }, [messages]);
  return null;
}
