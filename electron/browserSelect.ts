/// <reference lib="dom" />
import { createHash } from "node:crypto";
import type { WebContents } from "electron";
import {
  browserNodeInputPoint,
  runBrowserInput,
  withBrowserInputNode,
  type BrowserInputContext,
} from "./browserPageInput";
import type { BrowserToolResult } from "./browserTabHost";

export interface BrowserSelectOption {
  value?: string;
  label?: string;
  index?: number;
}

export function readBrowserSelectOptions(
  value: unknown,
): BrowserSelectOption[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new Error(
      "Browser select options must be an array of at most 100 choices",
    );
  return value.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).length === 0 ||
      !Object.values(entry).some((value) => value !== undefined) ||
      Object.keys(entry).some(
        (key) => !["value", "label", "index"].includes(key),
      )
    )
      throw new Error("Browser select choice requires value, label or index");
    for (const key of ["value", "label"] as const)
      if (
        entry[key] !== undefined &&
        (typeof entry[key] !== "string" || entry[key].length > 4000)
      )
        throw new Error(
          `Browser select ${key} must be a string of at most 4000 characters`,
        );
    if (
      entry.index !== undefined &&
      (!Number.isSafeInteger(entry.index) || entry.index < 0)
    )
      throw new Error("Browser select index must be a non-negative integer");
    return { ...entry };
  });
}

/** A selection can execute onchange handlers, so its receipt is always canonical. */
export async function executeBrowserSelect(
  contents: WebContents,
  args: Record<string, unknown>,
  context: BrowserInputContext & {
    expectedDescription: string | null;
    requestApproval(description: string): BrowserToolResult;
  },
): Promise<BrowserToolResult | { values: string[] }> {
  const options = readBrowserSelectOptions(args.options);
  return runBrowserInput(
    contents,
    (command) =>
      withBrowserInputNode(
        contents,
        Number(args.backendNodeId),
        command,
        async (objectId) => {
          const inspect = async (commit: boolean, expected?: string) => {
            const response = await command("Runtime.callFunctionOn", {
              objectId,
              functionDeclaration: selectBrowserOptions.toString(),
              arguments: [
                { value: options },
                { value: commit },
                { value: expected ?? null },
              ],
              returnByValue: true,
            });
            const result = response?.result?.value;
            if (response?.exceptionDetails || typeof result?.error === "string")
              throw new Error(
                result?.error ?? "Browser select target is unavailable",
              );
            if (
              typeof result?.description !== "string" ||
              !Array.isArray(result.values) ||
              result.values.some((v: unknown) => typeof v !== "string")
            )
              throw new Error("Browser select returned an invalid result");
            return result as { description: string; values: string[] };
          };
          const prepared = await inspect(false);
          const fingerprint = createHash("sha256")
            .update(prepared.description)
            .digest("hex");
          if (context.expectedDescription === null)
            return context.requestApproval(fingerprint);
          if (context.expectedDescription !== fingerprint)
            throw new Error(
              "Browser approved select target or options changed after preflight",
            );
          await browserNodeInputPoint(
            contents,
            Number(args.backendNodeId),
            command,
          );
          const result = await inspect(true, prepared.description);
          return { values: result.values };
        },
      ),
    context,
  );
}

/** Browser automation selection semantics: real value changes and synthetic input/change events. */
function selectBrowserOptions(
  this: HTMLSelectElement,
  choices: BrowserSelectOption[],
  commit: boolean,
  expected: string | null,
): { description: string; values: string[] } | { error: string } {
  if (
    !(this instanceof HTMLSelectElement) ||
    this.ownerDocument !== document ||
    !this.isConnected
  )
    return {
      error: "Browser select target is not a connected main-document select",
    };
  if (this.matches(":disabled"))
    return { error: "Browser select target is disabled" };
  if (this.options.length > 2000)
    return { error: "Browser select target has too many options" };
  const options = Array.from(this.options);
  const description = JSON.stringify({
    attributes: Array.from(this.attributes, (a) => [a.name, a.value]),
    multiple: this.multiple,
    options: options.map((o) => ({
      value: o.value,
      label: o.label,
      disabled: o.matches(":disabled"),
      selected: o.selected,
    })),
  });
  if (expected !== null && expected !== description)
    return {
      error: "Browser approved select target changed during preparation",
    };
  if (!this.multiple && choices.length > 1)
    return { error: "Browser single select accepts at most one option" };
  const selected: HTMLOptionElement[] = [];
  for (const choice of choices) {
    const matches = options.filter(
      (o, index) =>
        (choice.value === undefined || o.value === choice.value) &&
        (choice.label === undefined || o.label === choice.label) &&
        (choice.index === undefined || index === choice.index),
    );
    if (matches.length !== 1)
      return { error: "Browser select option is missing or ambiguous" };
    if (matches[0].matches(":disabled"))
      return { error: "Browser select option is disabled" };
    if (selected.includes(matches[0]))
      return { error: "Browser select contains duplicate choices" };
    selected.push(matches[0]);
  }
  if (commit) {
    const values = selected.map((option) => option.value);
    this.selectedIndex = -1;
    for (const option of selected) option.selected = true;
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    this.dispatchEvent(new Event("change", { bubbles: true }));
    if (
      !this.isConnected ||
      this.ownerDocument !== document ||
      Array.from(this.selectedOptions).some((o) => !selected.includes(o)) ||
      this.selectedOptions.length !== selected.length ||
      selected.some((option, index) => option.value !== values[index])
    )
      return {
        error:
          "Browser select changed during event handling; outcome is unknown, observe again",
      };
  }
  return {
    description,
    values: Array.from(
      commit ? this.selectedOptions : selected,
      (o) => o.value,
    ),
  };
}
