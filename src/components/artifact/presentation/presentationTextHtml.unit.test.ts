import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { a, r, children, one, readXml } from "./presentationPackageXml";
import {
  parsePresentationTextHtml,
  serializePresentationTextFragment,
} from "./presentationTextHtml";
import {
  createPresentationTextRangeAdapter,
  type PresentationTextFragment,
} from "./presentationTextRange";
import {
  paragraphText,
  presentationTextContent,
  textRuns,
} from "./presentationTextRangeXml";
import {
  serializeText,
  textBodyFixture,
} from "./presentationTextRange.testFixtures";

const parse = (html: string) => {
  const value = parsePresentationTextHtml(html, document);
  expect(
    value,
    `HTML should have a supported fragment: ${html.slice(0, 200)}`,
  ).toBeDefined();
  return value!;
};
const attribute = (element: Element, name: string, attribute: string) =>
  one(element, a, name)?.getAttribute(attribute);
const properties = (paragraph: Element) => one(paragraph, a, "pPr")!;
const runProperties = (paragraph: Element, index: number) =>
  one(textRuns(paragraph)[index], a, "rPr")!;
const text = (fragment: PresentationTextFragment) =>
  fragment.paragraphs.map(paragraphText).join("\n");

describe("Presentation detached HTML 与 DrawingML fragment 适配", () => {
  beforeEach(() => vi.stubGlobal("crypto", webcrypto));
  afterEach(() => vi.unstubAllGlobals());

  it("保留macOS系统剪贴板UTF-8元信息后的HTML样式、列表与链接", () => {
    const { fragment, hyperlinks } = parse(
      "<meta charset='utf-8'><p><strong>HTML_BOLD</strong> <em>HTML_ITALIC</em></p><ul><li>HTML_LIST</li></ul><p><a href=\"https://example.invalid/rich-paste\">HTML_LINK</a></p>",
    );
    expect(text(fragment)).toBe("HTML_BOLD HTML_ITALIC\nHTML_LIST\nHTML_LINK");
    expect(runProperties(fragment.paragraphs[0], 0).getAttribute("b")).toBe(
      "1",
    );
    expect(runProperties(fragment.paragraphs[0], 2).getAttribute("i")).toBe(
      "1",
    );
    expect(
      attribute(properties(fragment.paragraphs[1]), "buChar", "char"),
    ).toBe("•");
    expect(hyperlinks).toHaveLength(1);
    expect(hyperlinks[0].url).toBe("https://example.invalid/rich-paste");
  });

  it.each([
    '<meta http-equiv="refresh" content="0;url=https://example.test">',
    '<meta charset="utf-8" content="extra">',
    '<meta charset="utf-8" onload="bad()">',
    '<meta charset="utf-16">',
    '<meta charset="utf&#45;8">',
    '<meta charset="utf-8"><img src="https://example.test">',
  ])("HTML解析前拒绝非UTF-8编码标记或资源：%s", (html) => {
    const parser = vi.spyOn(DOMParser.prototype, "parseFromString");
    try {
      expect(
        parsePresentationTextHtml(`${html}<p>text</p>`, document),
      ).toBeUndefined();
      expect(parser.mock.calls.some(([, type]) => type === "text/html")).toBe(
        false,
      );
    } finally {
      parser.mockRestore();
    }
  });

  it("编码元标记不拼接相邻文本成资源标签", () => {
    const parser = vi.spyOn(DOMParser.prototype, "parseFromString");
    try {
      const { fragment } = parse(
        "<<meta charset=utf-8>img src=https://example.invalid/request>",
      );
      expect(text(fragment)).toBe("<img src=https://example.invalid/request>");
      expect(
        parser.mock.results.some((result) =>
          result.value?.querySelector?.("img,script,iframe,link"),
        ),
      ).toBe(false);
    } finally {
      parser.mockRestore();
    }
  });

  it("规范剪贴板片段注释保持正文与样式", () => {
    const { fragment } = parse(
      "<!--StartFragment--><p><strong>中😀</strong></p><!--EndFragment-->",
    );
    expect(text(fragment)).toBe("中😀");
    expect(runProperties(fragment.paragraphs[0], 0).getAttribute("b")).toBe(
      "1",
    );
  });

  it.each([
    "<!-- --!><img src=https://example.invalid/request> --><p>text</p>",
    "<!--><img src=https://example.invalid/request> --><p>text</p>",
    "<!-- --!><meta http-equiv=refresh content=0> --><p>text</p>",
    "<!--<!-- --><p>text</p>",
  ])("HTML解析前拒绝非规范或嵌套注释：%s", (html) => {
    const parser = vi.spyOn(DOMParser.prototype, "parseFromString");
    try {
      expect(parsePresentationTextHtml(html, document)).toBeUndefined();
      expect(parser.mock.calls.some(([, type]) => type === "text/html")).toBe(
        false,
      );
    } finally {
      parser.mockRestore();
    }
  });

  it("明确转换段落单位、缩进、对齐和段前后距，保留混合样式与Unicode", () => {
    const { fragment } = parse(
      '<p style="text-align:center;margin-left:24px;margin-right:6pt;text-indent:-12px;margin-top:8pt;margin-bottom:1.5lh"><strong>粗😀</strong><span style="font-size:16px;color:#aBc;font-family:\'Aptos Display\'">é</span><u><s>线</s></u><br>尾</p><div>二段</div>',
    );
    expect(text(fragment)).toBe("粗😀é线\n尾\n二段");
    const paragraph = fragment.paragraphs[0],
      property = properties(paragraph);
    expect(property.getAttribute("algn")).toBe("ctr");
    expect(property.getAttribute("marL")).toBe("228600");
    expect(property.getAttribute("marR")).toBe("76200");
    expect(property.getAttribute("indent")).toBe("-114300");
    expect(attribute(one(property, a, "spcBef")!, "spcPts", "val")).toBe("800");
    expect(attribute(one(property, a, "spcAft")!, "spcPct", "val")).toBe(
      "150000",
    );
    expect(runProperties(paragraph, 0).getAttribute("b")).toBe("1");
    const mixed = runProperties(paragraph, 1);
    expect(mixed.getAttribute("sz")).toBe("1200");
    expect(attribute(one(mixed, a, "solidFill")!, "srgbClr", "val")).toBe(
      "AABBCC",
    );
    expect(attribute(mixed, "latin", "typeface")).toBe("Aptos Display");
    expect(runProperties(paragraph, 2).getAttribute("u")).toBe("sng");
    expect(runProperties(paragraph, 2).getAttribute("strike")).toBe(
      "sngStrike",
    );
    expect(textRuns(paragraph)[3].localName).toBe("br");
  });

  it("语义标签与内联CSS覆盖按嵌套顺序处理，不把显式normal变成继承", () => {
    const { fragment } = parse(
      '<b><i>AB<span style="font-weight:normal;font-style:normal;text-decoration:underline line-through;color:rgb(0, 128, 255)">C</span></i></b>',
    );
    const paragraph = fragment.paragraphs[0];
    expect(text(fragment)).toBe("ABC");
    expect(runProperties(paragraph, 0).getAttribute("b")).toBe("1");
    expect(runProperties(paragraph, 0).getAttribute("i")).toBe("1");
    expect(runProperties(paragraph, 1).getAttribute("b")).toBe("0");
    expect(runProperties(paragraph, 1).getAttribute("i")).toBe("0");
    expect(
      attribute(
        one(runProperties(paragraph, 1), a, "solidFill")!,
        "srgbClr",
        "val",
      ),
    ).toBe("0080FF");
  });

  it("嵌套及同元素text-decoration声明按覆盖顺序处理，普通段落明确无列表", () => {
    const { fragment } = parse(
      '<p><u>A<span style="text-decoration:none">B</span></u><span style="text-decoration-line:underline;text-decoration:line-through">C</span></p>',
    );
    expect(runProperties(fragment.paragraphs[0], 0).getAttribute("u")).toBe(
      "sng",
    );
    expect(runProperties(fragment.paragraphs[0], 1).getAttribute("u")).toBe(
      "none",
    );
    expect(runProperties(fragment.paragraphs[0], 2).getAttribute("u")).toBe(
      "none",
    );
    expect(
      runProperties(fragment.paragraphs[0], 2).getAttribute("strike"),
    ).toBe("sngStrike");
    expect(one(properties(fragment.paragraphs[0]), a, "buNone")).toBeDefined();
  });

  it("ol/ul/li保留每项编号、start/value、嵌套级别和多段item", () => {
    const { fragment } = parse(
      '<ol start="4" type="a"><li><p>A</p><p>续</p><ul type="square"><li>B</li></ul></li><li value="9">C</li><li>D</li></ol>',
    );
    expect(text(fragment)).toBe("A\n续\nB\nC\nD");
    const [first, continuation, nested, reset, last] =
      fragment.paragraphs.map(properties);
    expect(first.getAttribute("lvl")).toBe("0");
    expect(attribute(first, "buAutoNum", "type")).toBe("alphaLcPeriod");
    expect(attribute(first, "buAutoNum", "startAt")).toBe("4");
    expect(one(continuation, a, "buNone")).toBeDefined();
    expect(nested.getAttribute("lvl")).toBe("1");
    expect(attribute(nested, "buChar", "char")).toBe("▪");
    expect(attribute(reset, "buAutoNum", "startAt")).toBe("9");
    expect(attribute(last, "buAutoNum", "startAt")).toBe("10");
  });

  it("默认HTML空白折叠，pre-wrap、空段与br保持独立语义", () => {
    const { fragment } = parse(
      '<div><p>A  <b>B</b>\n C<br>D</p><p style="white-space:pre-wrap">  中\t😀\n尾  </p><p style="font-weight:bold"></p></div>',
    );
    expect(text(fragment)).toBe("A B C\nD\n  中\t😀\n尾  \n");
    expect(fragment.paragraphs).toHaveLength(3);
    expect(runProperties(fragment.paragraphs[2], 0).getAttribute("b")).toBe(
      "1",
    );
    const restored = parse(serializePresentationTextFragment(fragment));
    expect(text(restored.fragment)).toBe(text(fragment));
  });

  it("owner仅用于创建脱离页面的OOXML，解析及导出不挂真实DOM或请求网络", () => {
    const fetch = vi.fn(() => {
      throw new Error("HTML codec must not fetch");
    });
    vi.stubGlobal("fetch", fetch);
    const observer = new MutationObserver(() => {});
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    const before = document.documentElement.outerHTML;
    const value = parse(
      '<p><a href="https://example.test/a?q=1&amp;b=2"><b>safe</b></a></p>',
    );
    serializePresentationTextFragment(
      value.fragment,
      (id) => value.hyperlinks.find((link) => link.id === id)?.url,
    );
    expect(document.documentElement.outerHTML).toBe(before);
    expect(observer.takeRecords()).toEqual([]);
    expect(
      value.fragment.paragraphs.every(
        (paragraph) =>
          paragraph.ownerDocument === document && !paragraph.isConnected,
      ),
    ).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    observer.disconnect();
  });

  it("资源标签、资源属性和CSS实体绕过在创建HTML文档前拒绝", () => {
    const parser = vi.spyOn(DOMParser.prototype, "parseFromString");
    try {
      for (const html of [
        '<img src="https://example.test">',
        '<body background="https://example.test">X</body>',
        '<html manifest="https://example.test"><body>X</body></html>',
        '<p style="font-family:serif&#59;background-image:url(https://example.test)">X</p>',
        '<p style="&#x62;ackground-image:url(https://example.test)">X</p>',
        "<p data-x=x' ><style>@import 'https://example.test';</style>'>X</p>",
      ]) {
        parser.mockClear();
        expect(parsePresentationTextHtml(html, document)).toBeUndefined();
        expect(parser.mock.calls.some(([, type]) => type === "text/html")).toBe(
          false,
        );
      }
    } finally {
      parser.mockRestore();
    }
  });

  it("缩进采用DrawingML精确边界，字号和百分比间距不会溢出", () => {
    const { fragment } = parse(
      '<p style="margin-left:4032pt;text-indent:-4032pt;font-size:4000pt;margin-top:201168pt;margin-bottom:132lh">X</p>',
    );
    const property = properties(fragment.paragraphs[0]);
    expect(property.getAttribute("marL")).toBe("51206400");
    expect(property.getAttribute("indent")).toBe("-51206400");
    expect(runProperties(fragment.paragraphs[0], 0).getAttribute("sz")).toBe(
      "400000",
    );
    for (const style of [
      "margin-left:4032.01pt",
      "text-indent:-4032.01pt",
      "font-size:4000.01pt",
      "margin-top:201168.01pt",
      "margin-bottom:132.00001lh",
      "margin-bottom:150%",
    ])
      expect(
        parsePresentationTextHtml(`<p style="${style}">X</p>`, document),
      ).toBeUndefined();
  });

  it("http/https/mailto关系每次新建唯一临时ID，重建HTML仍保留安全URL", () => {
    const html =
      '<p><a href="https://example.test/a?q=1&amp;b=2">A</a><a href="http://example.test">B</a><a href="mailto:dev@example.test?subject=hello%20world">C</a></p>';
    const first = parse(html),
      second = parse(html);
    const ids = [...first.hyperlinks, ...second.hyperlinks].map(
      (link) => link.id,
    );
    expect(new Set(ids).size).toBe(6);
    expect(ids.every((id) => /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id))).toBe(true);
    expect(first.hyperlinks.map(({ url }) => url)).toEqual([
      "https://example.test/a?q=1&b=2",
      "http://example.test/",
      "mailto:dev@example.test?subject=hello%20world",
    ]);
    expect(
      first.fragment.paragraphs[0].getElementsByTagNameNS(a, "hlinkClick"),
    ).toHaveLength(3);
    expect(
      Array.from(
        first.fragment.paragraphs[0].getElementsByTagNameNS(a, "hlinkClick"),
        (link) => link.getAttributeNS(r, "id"),
      ),
    ).toEqual(first.hyperlinks.map(({ id }) => id));
    const exported = serializePresentationTextFragment(
      first.fragment,
      (id) => first.hyperlinks.find((link) => link.id === id)?.url,
    );
    const reparsed = parse(exported);
    expect(reparsed.hyperlinks.map(({ url }) => url)).toEqual(
      first.hyperlinks.map(({ url }) => url),
    );
    expect(text(reparsed.fragment)).toBe("ABC");
  });

  it("字符实体安全转义，富文本默认属性及未知theme色不影响原fragment", () => {
    const paragraph = readXml(
      `<a:p xmlns:a="${a}" xmlns:r="${r}"><a:pPr><a:defRPr b="1" u="sng" strike="sngStrike"><a:solidFill><a:srgbClr val="123456"/></a:solidFill></a:defRPr></a:pPr><a:r><a:rPr strike="noStrike"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:extLst><a:ext uri="keep"/></a:extLst></a:rPr><a:t>&lt;script&gt;alert(&quot;x&quot;) &amp; 😀</a:t></a:r></a:p>`,
    ).documentElement;
    const before = serializeText(paragraph);
    const html = serializePresentationTextFragment({ paragraphs: [paragraph] });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("123456");
    const imported = parse(html).fragment.paragraphs[0],
      style = runProperties(imported, 0);
    expect(style.getAttribute("b")).toBe("1");
    expect(style.getAttribute("u")).toBe("sng");
    expect(style.getAttribute("strike")).toBe("noStrike");
    expect(paragraphText(imported)).toBe('<script>alert("x") & 😀');
    expect(serializeText(paragraph)).toBe(before);
  });

  it("已有range片段跨段导出再导入保留可表达样式/list/indent/spacing，原未知metadata不变", () => {
    const body = textBodyFixture(),
      before = serializeText(body);
    const adapter = createPresentationTextRangeAdapter(body, "shape:2");
    const fragment = adapter.getRangeFragment(
      adapter.positionAtOffset(2),
      adapter.positionAtOffset(presentationTextContent(body).length - 2),
    );
    const source = fragment.paragraphs.map(serializeText);
    const urls: Record<string, string> = {
      rLink: "https://example.test/a",
      rOther: "mailto:dev@example.test",
    };
    const result = parse(
      serializePresentationTextFragment(fragment, (id) => urls[id]),
    );
    expect(text(result.fragment)).toBe(text(fragment));
    expect(result.fragment.paragraphs).toHaveLength(3);
    const first = properties(result.fragment.paragraphs[0]);
    expect(first.getAttribute("lvl")).toBe("2");
    expect(first.getAttribute("marL")).toBe("321");
    expect(first.getAttribute("indent")).toBe("-12");
    expect(attribute(first, "buChar", "char")).toBe("•");
    expect(attribute(one(first, a, "spcBef")!, "spcPts", "val")).toBe("400");
    expect(attribute(one(first, a, "spcAft")!, "spcPct", "val")).toBe("150000");
    expect(
      attribute(
        properties(result.fragment.paragraphs[1]),
        "buAutoNum",
        "startAt",
      ),
    ).toBe("4");
    expect(result.hyperlinks.map(({ url }) => url)).toEqual(
      Object.values(urls),
    );
    expect(fragment.paragraphs.map(serializeText)).toEqual(source);
    expect(serializeText(body)).toBe(before);
    const target = textBodyFixture({
      paragraphs: ["<a:p><a:r><a:t>PREFIX|SUFFIX</a:t></a:r></a:p>"],
    });
    const targetRange = createPresentationTextRangeAdapter(target, "target");
    targetRange.replaceRangeWithFragment(
      targetRange.positionAtOffset(7),
      targetRange.positionAtOffset(7),
      result.fragment,
    );
    expect(presentationTextContent(target)).toBe(
      `PREFIX|${text(fragment)}SUFFIX`,
    );
  });

  it("局部noFill或渐变不能被父级RGB覆盖成猜测的纯色", () => {
    for (const fill of ["<a:noFill/>", "<a:gradFill/>"]) {
      const body = textBodyFixture({
        paragraphs: [
          `<a:p><a:pPr><a:defRPr><a:solidFill><a:srgbClr val="123456"/></a:solidFill></a:defRPr></a:pPr><a:r><a:rPr>${fill}</a:rPr><a:t>X</a:t></a:r></a:p>`,
        ],
      });
      const before = serializeText(body);
      const html = serializePresentationTextFragment({
        paragraphs: children(body, a, "p"),
      });
      expect(html).not.toContain("color:");
      expect(text(parse(html).fragment)).toBe("X");
      expect(serializeText(body)).toBe(before);
    }
  });

  it.each([
    "<script>globalThis.bad=true</script>",
    '<img src="https://example.test/request">',
    '<iframe src="https://example.test/request"></iframe>',
    '<svg><image href="https://example.test/request"/></svg>',
    '<p onclick="bad()">X</p>',
    '<a ping="https://example.test" href="https://example.test">X</a>',
    '<span style="background-image:url(https://example.test/request)">X</span>',
    '<span style="background-image:u\\72l(https://example.test/request)">X</span>',
    '<span style="font-weight:bold&#59;background-image:url(https://example.test/request)">X</span>',
    '<a href="javascript:alert(1)">X</a>',
    '<a href="java&#x73;cript:alert(1)">X</a>',
    '<a href="file:///private/file">X</a>',
    '<a href="data:text/html,bad">X</a>',
    '<a href="/relative">X</a>',
    '<a href="https://example.test/%0aHeader">X</a>',
    '<p style="font-size:0px">X</p>',
    '<p style="font-size:calc(12px + 1px)">X</p>',
    '<p style="margin-left:-1px">X</p>',
    '<ol start="0"><li>X</li></ol>',
    '<ol start="32768"><li>X</li></ol>',
    '<p data-presentation-list-level="9">X</p>',
    "<!DOCTYPE html><p>X</p>",
    "<p>\u0001</p>",
    "<p>\uD800</p>",
  ])("拒绝不支持/非法HTML并返回显式plain fallback：%s", (html) => {
    expect(parsePresentationTextHtml(html, document)).toBeUndefined();
  });

  it.each([
    ["空输入", ""],
    ["空白", " "],
    ["输入尺寸", "x".repeat(1024 * 1024 + 1)],
    ["节点", "<span>x</span>".repeat(20001)],
    ["段落", "<p>x</p>".repeat(10001)],
    ["嵌套", "<span>".repeat(66) + "x" + "</span>".repeat(66)],
  ])("%s 上限先于递归转换，拒绝的输入明确fallback", (_scenario, html) => {
    expect(parsePresentationTextHtml(html, document)).toBeUndefined();
  });

  it("实体属性不能通过CSS资源白名单，未知relationship只导出文本", () => {
    const { fragment } = parse(
      '<p style="font-family:&quot;Aptos Display&quot;;color:red"><a href="https://example.test">&lt;&amp;&gt;</a></p>',
    );
    const html = serializePresentationTextFragment(
      fragment,
      () => "javascript:bad()",
    );
    expect(html).not.toContain("href=");
    expect(text(parse(html).fragment)).toBe("<&>");
    expect(
      parsePresentationTextHtml(
        '<p style="font-family:serif&#59;behavior:url(x)">X</p>',
        document,
      ),
    ).toBeUndefined();
  });

  it("安全正文中的src/style字样及尖括号不会被当成资源属性", () => {
    const source = "src=https://example.test; style=color:red; x < 3; 😀";
    const value = parse(
      `<p title="A &gt; B">${source.replace(/</g, "&lt;")}</p>`,
    );
    expect(text(value.fragment)).toBe(source);
    expect(
      text(parse(serializePresentationTextFragment(value.fragment)).fragment),
    ).toBe(source);
  });

  it("序列化沿用TextRange验证拒绝field/math，不修改非法源fragment", () => {
    for (const paragraph of [
      '<a:p><a:fld type="slidenum"><a:t>1</a:t></a:fld></a:p>',
      '<a:p><a:r><a:t>X</a:t><m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"/></a:r></a:p>',
    ]) {
      const body = textBodyFixture({ paragraphs: [paragraph] }),
        before = serializeText(body);
      expect(() =>
        serializePresentationTextFragment({
          paragraphs: children(body, a, "p"),
        }),
      ).toThrow(/field|content/);
      expect(serializeText(body)).toBe(before);
    }
    expect(() =>
      serializePresentationTextFragment({
        paragraphs: [readXml("<p/>").documentElement],
      }),
    ).toThrow(/paragraph/);
    expect(serializePresentationTextFragment({ paragraphs: [] })).toBe("");
  });
});
