import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { register, unregister } from "@/lib/desktop-host/global-shortcut";
import { requestNewConversationTab } from "@/lib/conversationTabs";

const QUICK_CAPTURE_SHORTCUT = "Alt+Space";
const NOTCH_TOGGLE_SHORTCUT = "Alt+C";
const NOTCH_VOICE_SHORTCUT = "Alt+V";

export function QuickCaptureOverlay() {
  const { t } = useTranslation("navigation");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"capture" | "notch">("capture");
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let registered = false;
    let notchRegistered = false;
    let voiceRegistered = false;
    const show = () => {
      setMode("capture");
      setOpen(true);
    };
    const toggleNotch = () => {
      setMode("notch");
      setOpen((value) => !value);
    };
    const notchVoice = () => {
      setMode("notch");
      setOpen(true);
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("lime:toggle-dictation"));
      }, 220);
    };
    window.addEventListener("lime:open-quick-capture", show);
    window.addEventListener("lime:toggle-notch", toggleNotch);
    window.addEventListener("lime:notch-voice", notchVoice);
    void register(QUICK_CAPTURE_SHORTCUT, show)
      .then(() => {
        registered = true;
      })
      .catch(() => undefined);
    void register(NOTCH_TOGGLE_SHORTCUT, toggleNotch)
      .then(() => {
        notchRegistered = true;
      })
      .catch(() => undefined);
    void register(NOTCH_VOICE_SHORTCUT, notchVoice)
      .then(() => {
        voiceRegistered = true;
      })
      .catch(() => undefined);
    return () => {
      window.removeEventListener("lime:open-quick-capture", show);
      window.removeEventListener("lime:toggle-notch", toggleNotch);
      window.removeEventListener("lime:notch-voice", notchVoice);
      if (registered) {
        void unregister(QUICK_CAPTURE_SHORTCUT).catch(() => undefined);
      }
      if (notchRegistered) {
        void unregister(NOTCH_TOGGLE_SHORTCUT).catch(() => undefined);
      }
      if (voiceRegistered) {
        void unregister(NOTCH_VOICE_SHORTCUT).catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setValue("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    setOpen(false);
    requestNewConversationTab();
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("lime:set-composer-draft", { detail: { text } }),
      );
    }, 350);
  };

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 z-[110] flex items-start justify-center ${
        mode === "notch" ? "bg-black/20 pt-0" : "bg-black/30 pt-[5vh]"
      }`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("quickCapture.title")}
        className={`border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-3 shadow-2xl ${
          mode === "notch"
            ? "w-[min(560px,calc(100vw-32px))] rounded-b-2xl border-t-0"
            : "w-[min(680px,calc(100vw-32px))] rounded-2xl"
        }`}
      >
        <textarea
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t("quickCapture.placeholder")}
          aria-label={t("quickCapture.title")}
          rows={4}
          className="w-full resize-none bg-transparent text-sm text-[color:var(--lime-text-strong)] outline-none"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            } else if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <p className="mt-1 text-[11px] text-[color:var(--lime-text-muted)]">
          {t("quickCapture.hint")}
        </p>
      </div>
    </div>
  );
}
