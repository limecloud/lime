import { describe, expect, it } from "vitest";
import { DOMParser } from "@tiptap/pm/model";
import { undo, redo } from "@tiptap/pm/history";
import { ComposerController } from "./ComposerController";
import { composerDocumentFromJSON, composerSchema } from "./composerSchema";
import * as serialization from "./composerSerialization";
import {
  composerOffsetToPosition,
  composerPositionToOffset,
  composerTextSelection,
} from "./composerPositions";
import type { ComposerEditorDocument } from "./types";
import {
  codeDocument,
  linkDocument,
  mixedDocument,
} from "./composerMarks.testFixtures";

describe("Composer link and code contracts", () => {
  it("roundtrips complete link/source/literal attrs and code JSON", () => {
    const document = mixedDocument();
    expect(composerDocumentFromJSON(document).toJSON()).toEqual(document);
  });

  it.each([
    "javascript:alert(1)",
    "file:///tmp/x",
    "/relative",
    "https://e.test/a b",
  ])("rejects unsafe ordinary href %s", (href) => {
    expect(() => composerDocumentFromJSON(linkDocument({ href }))).toThrow();
  });

  it.each(["https://e.test", "http://e.test", "mailto:hello@example.com"])(
    "accepts ordinary protocol %s",
    (href) => {
      expect(() =>
        composerDocumentFromJSON(linkDocument({ href })),
      ).not.toThrow();
    },
  );

  it("rejects unknown marks/nodes and wrong known attrs", () => {
    const unknownMark = linkDocument();
    const text = unknownMark.content[0].content![0] as unknown as {
      marks: { type: string }[];
    };
    text.marks[0].type = "bold";
    expect(() => composerDocumentFromJSON(unknownMark)).toThrow();
    expect(() =>
      composerDocumentFromJSON({
        type: "doc",
        content: [{ type: "heading" }],
      } as unknown as ComposerEditorDocument),
    ).toThrow();
    expect(() =>
      composerDocumentFromJSON(linkDocument({ isGeneratedAutolink: "yes" })),
    ).toThrow();
    expect(() =>
      composerDocumentFromJSON(linkDocument({ title: 1 })),
    ).toThrow();
    expect(() =>
      composerDocumentFromJSON(
        linkDocument({ literalMarkdownOccurrenceId: "1" }),
      ),
    ).toThrow();
  });

  it("keeps display UTF16 separate from final UTF8 submission ranges", () => {
    const controller = new ComposerController({
      editorDocument: mixedDocument(),
    });
    const display = controller.getDocument();
    expect(display.text).toBe("中😀\n中😀\n````\n[paste]$审阅尾");
    expect(display.mentionBindings[0]).toMatchObject({ from: 20, to: 23 });
    const submission = controller.submit("queue").submission;
    expect(submission.text).toBe(
      "[中😀](https://e.test)\n`````ts\n中😀\n````\n`````\n长😀\n文[$审阅](/skills/review)尾",
    );
    expect(submission.textElements).toEqual([
      { byteRange: { start: 53, end: 64 }, placeholder: "[paste]" },
    ]);
    const bytes = new TextEncoder().encode(submission.text);
    expect(
      submission.textElements.map(({ byteRange }) =>
        new TextDecoder().decode(bytes.slice(byteRange.start, byteRange.end)),
      ),
    ).toEqual(["长😀\n文"]);
    expect(submission.inputMentions).toEqual([
      { type: "skill", name: "审阅", path: "/skills/review" },
    ]);
  });

  it("preserves legal display positions across link/code/atom boundaries", () => {
    const doc = composerDocumentFromJSON(mixedDocument());
    for (const offset of [0, 1, 3, 4, 5, 7, 8, 12, 13, 20, 23, 24]) {
      expect(
        composerPositionToOffset(doc, composerOffsetToPosition(doc, offset)),
      ).toBe(offset);
    }
    expect(
      composerPositionToOffset(doc, composerOffsetToPosition(doc, 2, -1)),
    ).toBe(1);
    expect(
      composerPositionToOffset(doc, composerOffsetToPosition(doc, 2, 1)),
    ).toBe(3);
    const atom = composerTextSelection(doc, { start: 21, end: 22 });
    expect(composerPositionToOffset(doc, atom.from)).toBe(20);
    expect(composerPositionToOffset(doc, atom.to)).toBe(23);
  });

  it("emits dynamic code fences without escaping body and keeps code whitespace", () => {
    const controller = new ComposerController({
      editorDocument: codeDocument("  中😀\n````\n"),
    });
    expect(controller.submit("start").submission.text).toBe(
      "`````ts\n  中😀\n````\n\n`````",
    );
    expect(controller.getDocument().text).toBe("  中😀\n````\n");
  });

  it("omits autodetected plaintext language and preserves explicit plaintext", () => {
    const automatic = codeDocument("x", "plaintext");
    expect(
      new ComposerController({ editorDocument: automatic }).submit("start")
        .submission.text,
    ).toBe("```\nx\n```");
    const explicit = structuredClone(automatic) as unknown as {
      type: "doc";
      content: { attrs: Record<string, unknown> }[];
    };
    explicit.content[0].attrs.autoDetectLanguage = false;
    expect(
      new ComposerController({
        editorDocument: explicit as unknown as ComposerEditorDocument,
      }).submit("start").submission.text,
    ).toBe("```plaintext\nx\n```");
  });

  it("parses known HTML link/pre semantics and filters invalid language", () => {
    const element = document.createElement("div");
    element.innerHTML =
      '<p><a href="https://e.test" title="标题">中😀</a></p><pre data-language="typescript"><code class="language-js">  x\n y</code></pre>';
    const doc = DOMParser.fromSchema(composerSchema).parse(element);
    expect(doc.child(0).firstChild!.marks[0].attrs).toMatchObject({
      href: "https://e.test",
      title: "标题",
    });
    expect(doc.child(1).type.name).toBe("code_block");
    expect(doc.child(1).attrs.language).toBe("typescript");
    expect(doc.child(1).textContent).toBe("  x\n y");
    element.innerHTML =
      '<pre><code data-language="bad language" class="language-js">x</code></pre>';
    expect(
      DOMParser.fromSchema(composerSchema).parse(element).child(0).attrs
        .language,
    ).toBeNull();
  });

  it("retains code structure during replaceRange and large paste", () => {
    const controller = new ComposerController({
      editorDocument: codeDocument("前😀后"),
    });
    controller.replaceRange({ start: 1, end: 3 }, "中\r\n😀");
    expect(controller.getDocument().text).toBe("前中\n😀后");
    expect(controller.getEditorState().doc.childCount).toBe(1);
    expect(controller.getEditorState().doc.firstChild!.type.name).toBe(
      "code_block",
    );
    const large = "长😀\n".repeat(400);
    controller.ingestPaste(large);
    expect(controller.getDocument().pendingPastes).toEqual([]);
    expect(controller.getEditorState().doc.firstChild!.type.name).toBe(
      "code_block",
    );
    expect(controller.getDocument().text).toContain(large);
  });

  it("annotation setters retain links, code, paste IDs and resources", () => {
    const controller = new ComposerController({
      editorDocument: mixedDocument(),
      inputCapabilityRoute: { kind: "plugin", id: "kept" },
    });
    const before = controller.captureDraft();
    controller.setTextElements(before.textElements);
    controller.setMentionBindings(before.mentionBindings);
    expect(controller.captureDraft()).toEqual(before);
    controller.setMentionBindings(
      before.mentionBindings.map((binding) => ({ ...binding, name: "new" })),
    );
    expect(controller.getDocument().editorDocument.content.slice(0, 2)).toEqual(
      before.editorDocument.content.slice(0, 2),
    );
    expect(controller.getDocument().inputCapabilityRoute).toEqual(
      before.inputCapabilityRoute,
    );
    expect(controller.getEditorState().doc.child(2).firstChild!.attrs.id).toBe(
      "paste-1",
    );
  });

  it("restores JSON/history/resources and prevents stale receipts clearing rich edits", () => {
    const controller = new ComposerController({
      editorDocument: mixedDocument(),
      attachments: [{ data: "image", mediaType: "image/png" }],
      pathReferences: [{ id: "r", path: "/r", name: "r", isDir: false }],
    });
    controller.setSelection(1, 3);
    const draft = controller.captureDraft();
    const old = controller.submit("start");
    if (old.kind !== "accepted") throw new Error("expected accepted");
    controller.restoreDraft(draft);
    expect(controller.commit(old)).toBe(false);
    expect(controller.captureDraft()).toEqual(draft);
    const receipt = controller.submit("queue");
    if (receipt.kind !== "accepted") throw new Error("expected accepted");
    expect(controller.commit(receipt)).toBe(true);
    expect(controller.recallHistory("previous")).toEqual(receipt.draft);
    expect(controller.recallHistory("next")!.text).toBe("");
  });

  it("undo/redo keeps link marks and code after real PM edits", () => {
    const controller = new ComposerController({
      editorDocument: mixedDocument(),
    });
    const before = controller.captureDraft();
    controller.replaceRange({ start: 4, end: 7 }, "修改😀");
    expect(
      undo(controller.getEditorState(), (transaction) =>
        controller.applyTransaction(transaction),
      ),
    ).toBe(true);
    expect(controller.getDocument().editorDocument).toEqual(
      before.editorDocument,
    );
    expect(
      redo(controller.getEditorState(), (transaction) =>
        controller.applyTransaction(transaction),
      ),
    ).toBe(true);
    expect(controller.getDocument().text).toContain("修改😀");
  });

  it("allows only exact literal replay and falls back after label/destination mismatch", () => {
    const serialize = (
      serialization as unknown as {
        serializeComposerDocument: (
          doc: ReturnType<typeof composerDocumentFromJSON>,
          options: { preserveLiteralMarkdown: boolean },
        ) => { text: string };
      }
    ).serializeComposerDocument;
    const literal = "[中😀](https://e.test '标题')";
    const doc = composerDocumentFromJSON(
      linkDocument({ title: "标题", literalMarkdownSource: literal }),
    );
    expect(serialize(doc, { preserveLiteralMarkdown: true }).text).toBe(
      literal,
    );
    expect(
      serialize(
        composerDocumentFromJSON(
          linkDocument({ title: "新标题", literalMarkdownSource: literal }),
        ),
        { preserveLiteralMarkdown: true },
      ).text,
    ).toBe('[中😀](https://e.test "新标题")');
    const marker = linkDocument({
      literalMarkdownSource: "[中😀](lime-text-link://https://e.test)",
    });
    expect(
      serialize(composerDocumentFromJSON(marker), {
        preserveLiteralMarkdown: true,
      }).text,
    ).toBe("[中😀](https://e.test)");
  });
});
