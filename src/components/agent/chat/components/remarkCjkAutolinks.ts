import type { Link, Root, Text } from "mdast";
import type { Parent } from "unist";

const CJK_SENTENCE_BOUNDARY =
  /[，。；：！？、…（）［］【】《》「」『』〈〉“”‘’]/u;

function splitAutolink(link: Link, source: string): [Link, Text] | undefined {
  const label = link.children[0];
  const start = link.position?.start.offset;
  const end = link.position?.end.offset;
  if (
    link.children.length !== 1 ||
    label.type !== "text" ||
    start === undefined ||
    end === undefined ||
    !/^(?:https?:\/\/|www\.)/i.test(label.value) ||
    source.slice(start, end) !== label.value
  )
    return;

  // Only bare GFM links have source text identical to their label. Explicit
  // Markdown links and angle autolinks may intentionally contain punctuation.
  const boundary = label.value.search(CJK_SENTENCE_BOUNDARY);
  if (boundary < 0) return;
  const value = label.value.slice(0, boundary);
  return [
    {
      type: "link",
      url: /^www\./i.test(value) ? `http://${value}` : value,
      children: [{ type: "text", value }],
    },
    { type: "text", value: label.value.slice(boundary) },
  ];
}

function visitLinks(parent: Parent, source: string) {
  for (let index = 0; index < parent.children.length; index++) {
    const node = parent.children[index];
    if (node.type === "link") {
      const split = splitAutolink(node as Link, source);
      if (split) {
        parent.children.splice(index, 1, ...split);
        index++;
      }
    } else if ("children" in node) {
      visitLinks(node as Parent, source);
    }
  }
}

export function remarkCjkAutolinks() {
  return (tree: Root, file: { value: unknown }) => {
    visitLinks(tree, String(file.value));
  };
}
