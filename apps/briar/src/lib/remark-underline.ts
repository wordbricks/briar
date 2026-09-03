/**
 * Turns inline `<u>` / `</u>` tags into real underline nodes so DM paste can
 * keep underlines without enabling raw HTML in MarkdownContent.
 */

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: { hName?: string };
};

const openingUnderline = /^<u(\s[^>]*)?>$/iu;
const closingUnderline = /^<\/u\s*>$/iu;
const wholeUnderline = /^<u(\s[^>]*)?>([\s\S]*)<\/u\s*>$/iu;

export function remarkUnderline() {
  return (tree: MarkdownNode) => {
    walk(tree);
  };
}

function walk(node: MarkdownNode) {
  if (node.type === "code" || node.type === "inlineCode") return;
  if (!node.children?.length) return;
  for (const child of node.children) walk(child);
  node.children = rewrite(node.children);
}

function rewrite(children: MarkdownNode[]): MarkdownNode[] {
  const next: MarkdownNode[] = [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    const whole = htmlValue(child)?.match(wholeUnderline);
    if (whole) {
      next.push(underlineNode([{ type: "text", value: whole[2] ?? "" }]));
      continue;
    }
    if (!isOpeningUnderline(child)) {
      next.push(child);
      continue;
    }
    const close = children.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > index && isClosingUnderline(candidate),
    );
    if (close < 0) {
      next.push(child);
      continue;
    }
    next.push(underlineNode(children.slice(index + 1, close)));
    index = close;
  }
  return next;
}

function underlineNode(children: MarkdownNode[]): MarkdownNode {
  return {
    type: "underline",
    data: { hName: "u" },
    children,
  };
}

function htmlValue(node: MarkdownNode) {
  return node.type === "html" ? node.value?.trim() ?? "" : "";
}

function isOpeningUnderline(node: MarkdownNode) {
  return openingUnderline.test(htmlValue(node));
}

function isClosingUnderline(node: MarkdownNode) {
  return closingUnderline.test(htmlValue(node));
}
