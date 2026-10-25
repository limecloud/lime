import { useEffect, useRef, useState } from "react";
import { Pencil, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { bindingIdentity } from "@/lib/commands/bindings";
import { useShortcutCapture } from "@/lib/commands/useShortcutCapture";
import type { RegisteredCommand } from "@/lib/commands/registry";
import {
  formatShortcutStrokes,
  type HotkeyPlatform,
} from "@/lib/hotkeys/platform";
import { SettingsAction, SettingsRow } from "../../SettingsPrimitives";

const iconButton =
  "flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";

export function CommandRow({
  command,
  platform,
  disabled,
  error,
  onUpdate,
  onCancelCapture,
}: {
  command: RegisteredCommand;
  platform: HotkeyPlatform;
  disabled: boolean;
  error?: string;
  onUpdate: (bindings: string[] | null) => Promise<boolean>;
  onCancelCapture: () => void;
}) {
  const { t } = useTranslation("settings");
  const { t: navigation } = useTranslation("navigation");
  const [editing, setEditing] = useState<number | null>(null);
  const [appendHint, setAppendHint] = useState<number | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const focusIndex = useRef(0);
  const alive = useRef(false);
  const title = navigation(command.titleKey);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (editing !== null) input.current?.focus();
    else if (restoreFocus.current) {
      const buttons = controls.current?.querySelectorAll<HTMLButtonElement>(
        "[data-binding-button]",
      );
      buttons?.[focusIndex.current]?.focus();
      restoreFocus.current = false;
    }
  }, [editing, focusRequest]);
  const update = async (bindings: string[] | null) => {
    const saved = await onUpdate(bindings);
    if (!alive.current) return;
    if (saved) {
      restoreFocus.current = true;
      setEditing(null);
      setFocusRequest((value) => value + 1);
    } else input.current?.focus();
  };
  const cancelCapture = (focus: boolean) => {
    restoreFocus.current = focus;
    setEditing(null);
    onCancelCapture();
  };
  const capture = useShortcutCapture({
    enabled: editing !== null && !disabled,
    platform,
    allowsSequences: ![
      "composer.submit",
      "browser.toggleAnnotationMode",
    ].includes(command.id),
    onCapture: (binding) => {
      if (editing === null) return;
      const bindings = [...command.bindings];
      bindings[editing] = binding;
      void update(bindings);
    },
    onCancel: cancelCapture,
  });
  const bindings: (string | null)[] = command.bindings.length
    ? [...command.bindings]
    : [null];
  if (editing === command.bindings.length && command.bindings.length)
    bindings.push(null);
  const resetIndex = Math.max(
    0,
    command.bindings.findIndex(
      (binding, index) =>
        bindingIdentity(binding, platform) !==
        bindingIdentity(command.defaultBindings[index] ?? "", platform),
    ),
  );
  return (
    <SettingsRow
      data-command-id={command.id}
      label={title}
      description={
        <>
          {command.descriptionKey ? navigation(command.descriptionKey) : null}
          {error ? (
            <span role="alert" className="block text-destructive">
              {error}
            </span>
          ) : null}
        </>
      }
    >
      <div
        ref={controls}
        role="group"
        aria-label={title}
        className="flex w-96 max-w-full flex-col items-stretch gap-1"
      >
        {bindings.map((binding, index) => (
          <div key={index} className="flex min-h-8 items-center gap-1">
            {editing === index ? (
              <div className="flex items-center gap-2">
                <input
                  ref={input}
                  data-shortcut-capture
                  aria-label={t("settings.keyboardShortcuts.capture", {
                    title,
                  })}
                  aria-invalid={Boolean(error)}
                  aria-busy={disabled}
                  placeholder={t("settings.keyboardShortcuts.pressKeys")}
                  value={capture.preview}
                  readOnly
                  className="h-7 w-36 max-w-full rounded-md border border-ring bg-transparent px-2 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onBlur={capture.onBlur}
                  onKeyDown={capture.onKeyDown}
                />
                <SettingsAction
                  type="button"
                  disabled={disabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => cancelCapture(true)}
                >
                  {t("settings.keyboardShortcuts.cancel")}
                </SettingsAction>
              </div>
            ) : (
              <>
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <span className="flex min-h-8 items-center gap-1 px-2 text-[13px] text-muted-foreground">
                    {binding
                      ? formatShortcutStrokes(binding, platform).map(
                          (stroke, strokeIndex) => (
                            <span
                              key={strokeIndex}
                              data-shortcut-stroke
                              className={`flex items-center gap-1${strokeIndex ? " ml-2" : ""}`}
                            >
                              {stroke.map((token, keyIndex) => (
                                <kbd
                                  key={keyIndex}
                                  className="font-sans font-normal"
                                >
                                  {token}
                                </kbd>
                              ))}
                            </span>
                          ),
                        )
                      : t("settings.keyboardShortcuts.unassigned")}
                  </span>
                  <button
                    type="button"
                    data-binding-button
                    disabled={disabled}
                    aria-label={
                      appendHint === index
                        ? t("settings.keyboardShortcuts.add")
                        : t("settings.keyboardShortcuts.change", { title })
                    }
                    title={
                      appendHint === index
                        ? t("settings.keyboardShortcuts.add")
                        : t("settings.keyboardShortcuts.change", { title })
                    }
                    className={iconButton}
                    onMouseEnter={(event) =>
                      setAppendHint(binding && event.shiftKey ? index : null)
                    }
                    onMouseMove={(event) =>
                      setAppendHint(binding && event.shiftKey ? index : null)
                    }
                    onMouseLeave={() => setAppendHint(null)}
                    onClick={(event) => {
                      focusIndex.current = index;
                      setAppendHint(null);
                      setEditing(
                        binding && event.shiftKey
                          ? command.bindings.length
                          : index,
                      );
                    }}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </button>
                </div>
                <div className="ml-2 flex shrink-0 items-center justify-end gap-1">
                  {binding ? (
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={t("settings.keyboardShortcuts.clear")}
                      title={t("settings.keyboardShortcuts.clear")}
                      className={iconButton}
                      onClick={() => {
                        focusIndex.current = Math.min(
                          index,
                          Math.max(0, command.bindings.length - 2),
                        );
                        void update(
                          command.bindings.filter(
                            (_, candidate) => candidate !== index,
                          ),
                        );
                      }}
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  ) : null}
                  {command.customized && index === resetIndex ? (
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={t("settings.keyboardShortcuts.restore")}
                      title={t("settings.keyboardShortcuts.restore")}
                      className={iconButton}
                      onClick={() => {
                        focusIndex.current = 0;
                        void update(null);
                      }}
                    >
                      <RotateCcw className="size-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </SettingsRow>
  );
}
