import { describe, expect, it, vi } from "vitest";
import {
  loadCodeBlockParser,
  createCodeBlockLoaders,
  createTsrxGrammar,
} from "./composerCodeBlockHighlight";
import {
  codeBlockLanguages,
  detectCodeBlockLanguage,
} from "./composerCodeBlockLanguage";
import referenceLanguages from "./composerCodeBlockReference.testFixtures.json";

describe("code block grammar and parser loading", () => {
  it("supports the confirmed grammar catalog and leaves mermaid/plain unhighlighted", async () => {
    const parser = await loadCodeBlockParser();
    for (const language of codeBlockLanguages) {
      expect(parser.supports(language.value), language.value).toBe(
        language.value !== "mermaid",
      );
    }
    expect(parser.supports("graphql")).toBe(true);
    expect(parser.supports("wasm")).toBe(true);
    expect(parser.supports("tsrx")).toBe(true);
    expect(parser.supports("mermaid")).toBe(false);
    for (const language of ["plaintext", "mermaid", "unknown"]) {
      expect(
        parser.parse({ content: "const a = 1", language, pos: 0 }),
      ).toEqual([]);
    }
    expect(
      parser.parse({
        content: "query Foo { field }",
        language: "graphql",
        pos: 7,
      }).length,
    ).toBeGreaterThan(0);
    expect(
      parser.parse({
        content: '(module (func (export "main") (result i32) i32.const 1))',
        language: "wasm",
        pos: 0,
      }).length,
    ).toBeGreaterThan(0);
    expect(
      parser.parse({ content: "\\frac{1}{2}", language: "math", pos: 0 })
        .length,
    ).toBeGreaterThan(0);
  });

  it("registers all 53 observed raw grammars and five parser alias groups without expanding the 41-item picker", async () => {
    const parser = await loadCodeBlockParser();
    expect(referenceLanguages.registeredGrammars).toHaveLength(53);
    expect(Object.keys(referenceLanguages.parserAliases)).toHaveLength(5);
    for (const language of referenceLanguages.registeredGrammars)
      expect(parser.supports(language), language).toBe(true);
    for (const aliases of Object.values(referenceLanguages.parserAliases)) {
      for (const alias of aliases)
        expect(parser.supports(alias), alias).toBe(true);
    }
    expect(codeBlockLanguages).toHaveLength(41);
    expect(
      parser.parse({ content: "plain text", language: "plaintext", pos: 0 }),
    ).toEqual([]);
  });

  it("uses real grammar relevance for unhinted source and excludes unregistered names", async () => {
    const parser = await loadCodeBlockParser();
    const source =
      "pub fn answer<'a>(value: &'a str) -> Option<&'a str> { Some(value) }";
    const detection = parser.detect(source, [
      "rust",
      "tsrx",
      "mermaid",
      "unknown",
    ]);
    expect(detection.language).toBe("rust");
    expect(detection.relevance).toBeGreaterThanOrEqual(2);
    expect(await detectCodeBlockLanguage(source, parser.detect)).toBe("rust");
    expect(
      parser.detect("a long phrase with no registered grammar", [
        "tsrx",
        "unknown",
      ]).language,
    ).toBeNull();
  });

  it("produces nested attribute/CSS scopes in the real TSRX HAST grammar separately from PM root projection", async () => {
    const [{ createLowlight }, { default: typescript }, { default: css }] =
      await Promise.all([
        import("lowlight"),
        import("highlight.js/lib/languages/typescript"),
        import("highlight.js/lib/languages/css"),
      ]);
    const grammar = createLowlight({
      tsrx: createTsrxGrammar(typescript),
      css,
    });
    const source =
      'const App = () => @{ <div title={"中😀"}><style>p { color: red; }</style></div> };';
    const tree = grammar.highlight("tsrx", source);
    type Token = (typeof tree.children)[number];
    const scopes: string[] = [];
    const cssProperties: string[] = [];
    const read = (node: Token): string => {
      if (node.type === "text") return node.value;
      if (node.type !== "element") throw new Error("unexpected grammar token");
      const text = node.children.map(read).join("");
      const classes = node.properties.className;
      if (Array.isArray(classes)) {
        scopes.push(...classes.map(String));
        if (classes.includes("hljs-attribute")) cssProperties.push(text);
      }
      return text;
    };
    expect(tree.children.map(read).join("")).toBe(source);
    expect(scopes).toEqual(
      expect.arrayContaining([
        "hljs-keyword",
        "hljs-tag",
        "hljs-name",
        "hljs-attr",
        "css",
      ]),
    );
    expect(cssProperties).toContain("color");
  });

  it("deduplicates concurrent successful loader requests", async () => {
    const real = await loadCodeBlockParser();
    let resolve!: (value: typeof real) => void;
    const pending = new Promise<typeof real>((done) => {
      resolve = done;
    });
    const detector = vi.fn(() => pending);
    const parser = vi.fn(async () => real);
    const owner = createCodeBlockLoaders({ detector, parser });
    const first = owner.loadDetector(),
      second = owner.loadParser(),
      third = owner.loadParser();
    await Promise.resolve();
    expect(detector).toHaveBeenCalledTimes(1);
    resolve(real);
    expect(await Promise.all([first, second, third])).toEqual([
      real,
      real,
      real,
    ]);
    expect(parser).toHaveBeenCalledTimes(1);
  });
});
