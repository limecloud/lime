import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserAnnotationEditorBridge,
  BrowserAnnotationEditorUpdate,
} from "@/lib/api/browserAnnotationEditorTypes";
import { BrowserAnnotationEditor } from "./BrowserAnnotationEditor";
import { initial } from "./browserAnnotationEditor.testFixture";
import { BrowserDesignEditor } from "./BrowserDesignEditor";
import { changeLimeLocale, getLimeI18n } from "@/i18n/createI18n";
import type { BrowserDesignChange } from "@/lib/api/browserDesign";
import "@/components/input-kit/composerEditor.testUtils";

const labels = {
  title: "Design tweaks",
  text: "Text content",
  reset: "Reset all changes",
  invalid: "Invalid CSS",
};
const snapshot = {
  elementTagName: "button",
  declarations: [
    { property: "font-size", value: "16px", previousValue: "16px" },
  ],
  text: { value: "Original", previousValue: "Original" },
};
let root: Root | undefined;
let container: HTMLDivElement;
function render(element: ReactNode) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(element));
}
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});
const screen = {
  getByLabelText(label: string): HTMLInputElement | HTMLTextAreaElement {
    const element = Array.from(
      container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        "input, textarea",
      ),
    ).find((item) => item.getAttribute("aria-label") === label);
    if (!element) throw new Error(`Missing field ${label}`);
    return element;
  },
  getByRole(role: string, options?: { name: string }): HTMLElement {
    const element = Array.from(
      container.querySelectorAll<HTMLElement>(
        role === "button" ? "button" : `[role="${role}"]`,
      ),
    ).find(
      (item) =>
        !options ||
        item.textContent === options.name ||
        item.getAttribute("aria-label") === options.name,
    );
    if (!element) throw new Error(`Missing ${role} ${options?.name}`);
    return element;
  },
};
const fireEvent = {
  change(
    element: HTMLInputElement | HTMLTextAreaElement,
    event: { target: { value: string } },
  ) {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    act(() => {
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
        element,
        event.target.value,
      );
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  },
  click(element: HTMLElement) {
    act(() => element.click());
  },
};

describe("trusted design editor", () => {
  it("preserves both fields when edits arrive before the next render", () => {
    const changed = vi.fn();
    function Harness() {
      const [change, setChange] = useState<BrowserDesignChange | null>(null);
      return (
        <BrowserDesignEditor
          snapshot={snapshot}
          change={change}
          labels={labels}
          disabled={false}
          onInvalid={vi.fn()}
          onChange={(next) => {
            changed(next);
            setChange(next);
          }}
        />
      );
    }
    render(<Harness />);
    act(() => {
      fireEvent.change(screen.getByLabelText("font-size"), {
        target: { value: "28px" },
      });
      fireEvent.change(screen.getByLabelText(labels.text), {
        target: { value: "Revised" },
      });
    });
    expect(changed).toHaveBeenLastCalledWith({
      declarations: [
        { property: "font-size", previousValue: "16px", value: "28px" },
      ],
      text: { previousValue: "Original", value: "Revised" },
    });
  });
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
    "uses the actual %s resources for design fields and reset",
    async (locale) => {
      await changeLimeLocale(locale);
      const t = getLimeI18n().getFixedT(locale, "agent");
      const label = (key: string) => String(t(`browserAnnotation.${key}`));
      const localized = {
        title: label("designTitle"),
        text: label("designText"),
        reset: label("designReset"),
        invalid: label("designInvalid"),
      };
      expect(
        Object.values(localized).some((value) =>
          value.includes("browserAnnotation."),
        ),
      ).toBe(false);
      render(
        <BrowserDesignEditor
          snapshot={snapshot}
          change={null}
          labels={localized}
          disabled={false}
          onChange={vi.fn()}
          onInvalid={vi.fn()}
        />,
      );
      expect(screen.getByLabelText(localized.text).value).toBe("Original");
      expect(
        screen.getByRole("button", { name: localized.reset }),
      ).toBeDefined();
    },
  );
  it("keeps invalid CSS out of the preview and resets all fields to the original baseline", () => {
    const changed = vi.fn(),
      invalid = vi.fn();
    function Harness() {
      const [change, setChange] = useState<BrowserDesignChange | null>(null);
      return (
        <BrowserDesignEditor
          snapshot={snapshot}
          change={change}
          labels={labels}
          disabled={false}
          onInvalid={invalid}
          onChange={(next) => {
            setChange(next);
            changed(next);
          }}
        />
      );
    }
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("font-size"), {
      target: { value: "20px" },
    });
    expect(changed).toHaveBeenLastCalledWith({
      declarations: [
        { property: "font-size", previousValue: "16px", value: "20px" },
      ],
    });
    fireEvent.change(screen.getByLabelText("font-size"), {
      target: { value: "red; } body {display:none" },
    });
    expect(screen.getByRole("alert").textContent).toBe("Invalid CSS");
    expect(changed).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: labels.reset }));
    expect(changed).toHaveBeenLastCalledWith(null);
    expect((screen.getByLabelText("font-size") as HTMLInputElement).value).toBe(
      "16px",
    );
    expect(invalid).toHaveBeenLastCalledWith(false);
  });

  it("saves a design-only draft through the same trusted action/revision and blocks invalid visible fields", () => {
    let publish: ((update: BrowserAnnotationEditorUpdate) => void) | undefined;
    const bridge: BrowserAnnotationEditorBridge = {
      onUpdate: (callback) => {
        publish = callback;
        return () => {};
      },
      ready: vi.fn(),
      resize: vi.fn(),
      act: vi.fn(),
    };
    render(<BrowserAnnotationEditor bridge={bridge} />);
    act(() =>
      publish?.({
        ...initial,
        presentation: {
          ...initial.presentation,
          body: "",
          designSnapshot: snapshot,
          designChange: null,
          labels: { ...initial.presentation.labels, design: labels },
        },
      }),
    );
    fireEvent.change(screen.getByLabelText(labels.text), {
      target: { value: "Updated" },
    });
    const design = {
      declarations: [],
      text: { previousValue: "Original", value: "Updated" },
    };
    expect(bridge.act).toHaveBeenLastCalledWith("change", "", 5, [], design);
    fireEvent.change(screen.getByLabelText("font-size"), {
      target: { value: "broken" },
    });
    expect(
      (
        screen.getByRole("button", {
          name: initial.presentation.labels.save,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("font-size"), {
      target: { value: "16px" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: initial.presentation.labels.save }),
    );
    expect(bridge.act).toHaveBeenLastCalledWith("save", "", 5, [], design);
  });
});
