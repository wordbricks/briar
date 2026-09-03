/**
 * Turns clipboard HTML from Word, Google Docs, and browsers into the markdown
 * subset channel/DM messages already render: lists, indent, bold, italic,
 * strike, underline (`<u>`), and http(s)/mailto links.
 */

const skippedTags = new Set([
  "head",
  "link",
  "meta",
  "script",
  "style",
  "title",
  "xml",
]);

const blockTags = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "div",
  "dl",
  "dt",
  "dd",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);

type InlineMarks = {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  underline: boolean;
  code: boolean;
};

const noMarks: InlineMarks = {
  bold: false,
  italic: false,
  strike: false,
  underline: false,
  code: false,
};

const allowedLinkProtocols = new Set(["http:", "https:", "mailto:"]);

export function htmlToMarkdown(html: string): string {
  const source = html.trim();
  if (!source) return "";
  const document = new DOMParser().parseFromString(unwrapFragment(source), "text/html");
  const root = document.body ?? document.documentElement;
  if (!root) return "";
  return normalizeMarkdown(convertBlocks(root, 0, noMarks));
}

export function markdownFromClipboardHtml(html: string): string | null {
  const markdown = htmlToMarkdown(html).trim();
  return markdown.length > 0 ? markdown : null;
}

function unwrapFragment(html: string) {
  return html
    .replace(/<!--StartFragment-->/giu, "")
    .replace(/<!--EndFragment-->/giu, "");
}

function convertBlocks(
  parent: ParentNode,
  indent: number,
  marks: InlineMarks,
): string {
  const parts: string[] = [];
  let pendingListItems: string[] | null = null;
  const listIndexByLevel = new Map<number, number>();
  let inlineBuffer = "";

  const flushInline = () => {
    const text = stripTrailingLineSpace(inlineBuffer).trim();
    inlineBuffer = "";
    if (text) parts.push(wrapMarks(text, noMarks, marks));
  };

  const flushList = () => {
    if (!pendingListItems) return;
    parts.push(pendingListItems.join("\n"));
    pendingListItems = null;
    listIndexByLevel.clear();
  };

  const pushBlock = (markdown: string) => {
    flushInline();
    const trimmed = markdown.trimEnd();
    if (!trimmed) return;
    flushList();
    parts.push(trimmed);
  };

  const pushListItem = (ordered: boolean, level: number, markdown: string) => {
    flushInline();
    const item = markdown.replace(/^\s+|\s+$/gu, "");
    if (!item) return;
    if (!pendingListItems) pendingListItems = [];
    for (const key of [...listIndexByLevel.keys()]) {
      if (key > level) listIndexByLevel.delete(key);
    }
    const index = listIndexByLevel.get(level) ?? 0;
    listIndexByLevel.set(level, index + 1);
    pendingListItems.push(formatListItem(ordered, level, index, item));
  };

  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.COMMENT_NODE) continue;
    if (node.nodeType === Node.TEXT_NODE) {
      inlineBuffer += convertText(node.textContent ?? "", marks);
      continue;
    }
    if (!(node instanceof Element)) continue;
    const tag = node.tagName.toLowerCase();
    if (skippedTags.has(tag)) continue;
    if (tag === "br") {
      inlineBuffer += hardBreak();
      continue;
    }

    const nextMarks = marksFromElement(node, marks);
    if (containsBlock(node) && !blockTags.has(tag) && tag !== "a") {
      const inner = convertBlocks(node, indent, nextMarks);
      if (inner) pushBlock(inner);
      continue;
    }
    const mso = msoListInfo(node);

    if (mso) {
      const content = stripMsoIgnore(node);
      pushListItem(
        mso.ordered,
        indent + mso.level,
        convertInlines(content, nextMarks),
      );
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      flushInline();
      flushList();
      const nested = convertList(node, indent, nextMarks);
      if (nested) parts.push(nested);
      continue;
    }

    if (tag === "li") {
      flushInline();
      flushList();
      parts.push(convertListItem(node, false, indent, 0, nextMarks));
      continue;
    }

    if (tag === "blockquote") {
      const inner = convertBlocks(node, indent, nextMarks)
        .split("\n")
        .map((line) => (line.length > 0 ? `> ${line}` : ">"))
        .join("\n");
      pushBlock(inner);
      continue;
    }

    if (tag === "pre") {
      pushBlock(`\`\`\`\n${node.textContent?.replace(/\n$/u, "") ?? ""}\n\`\`\``);
      continue;
    }

    if (tag === "hr") {
      pushBlock("---");
      continue;
    }

    if (tag === "h1" || tag === "h2" || tag === "h3") {
      const hashes = "#".repeat(Number(tag[1]));
      pushBlock(`${hashes} ${convertInlines(node, nextMarks)}`);
      continue;
    }

    if (tag === "table") {
      pushBlock(convertTable(node, nextMarks));
      continue;
    }

    if (blockTags.has(tag)) {
      const inner = convertBlocks(node, indent, nextMarks);
      if (inner) pushBlock(inner);
      continue;
    }

    inlineBuffer += convertInlineElement(node, marks);
  }

  flushInline();
  flushList();
  return parts.filter(Boolean).join("\n\n");
}

function convertList(
  list: Element,
  indent: number,
  marks: InlineMarks,
): string {
  const ordered = list.tagName.toLowerCase() === "ol";
  const items = Array.from(list.children).filter(
    (child) => child.tagName.toLowerCase() === "li",
  );
  return items
    .map((item, index) => convertListItem(item, ordered, indent, index, marks))
    .filter(Boolean)
    .join("\n");
}

function convertListItem(
  item: Element,
  ordered: boolean,
  indent: number,
  index: number,
  marks: InlineMarks,
): string {
  const nested: string[] = [];
  const inlineParent = item.cloneNode(false) as Element;
  for (const child of Array.from(item.childNodes)) {
    if (
      child instanceof Element &&
      (child.tagName.toLowerCase() === "ul" ||
        child.tagName.toLowerCase() === "ol")
    ) {
      const nestedList = convertList(child, indent + 1, marks);
      if (nestedList) nested.push(nestedList);
      continue;
    }
    inlineParent.appendChild(child.cloneNode(true));
  }
  const hasBlockChild = Array.from(inlineParent.childNodes).some((child) =>
    child instanceof Element &&
    (blockTags.has(child.tagName.toLowerCase()) || containsBlock(child)),
  );
  const content = hasBlockChild
    ? convertBlocks(inlineParent, 0, marks).trim()
    : convertInlines(inlineParent, marks).trim();
  const head = formatListItem(ordered, indent, index, content);
  return nested.length > 0 ? `${head}\n${nested.join("\n")}` : head;
}

function formatListItem(
  ordered: boolean,
  indent: number,
  index: number,
  content: string,
): string {
  const marker = ordered ? `${index + 1}. ` : "- ";
  const pad = "\t".repeat(indent);
  const [first, ...rest] = content.split("\n");
  const continuation = rest
    .filter((line) => line.length > 0)
    .map((line) => `${pad}\t${line}`)
    .join("\n");
  return continuation
    ? `${pad}${marker}${first}\n${continuation}`
    : `${pad}${marker}${first}`;
}

function convertInlines(parent: ParentNode, marks: InlineMarks): string {
  let result = "";
  for (const node of Array.from(parent.childNodes)) {
    result += convertInlineNode(node, marks);
  }
  return stripTrailingLineSpace(result).replace(/\n{3,}/gu, "\n\n");
}

function convertInlineNode(node: Node, marks: InlineMarks): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return convertText(node.textContent ?? "", marks);
  }
  if (!(node instanceof Element)) return "";
  return convertInlineElement(node, marks);
}

function convertInlineElement(element: Element, inherited: InlineMarks): string {
  const tag = element.tagName.toLowerCase();
  if (skippedTags.has(tag) || tag === "img") return "";
  if (tag === "br") return hardBreak();
  if (tag === "ul" || tag === "ol") {
    const nested = convertList(element, 0, inherited);
    return nested ? `\n${nested}\n` : "";
  }
  const marks = marksFromElement(element, inherited);
  if (tag === "a") {
    const href = safeHref(element.getAttribute("href"));
    const label = convertInlines(element, marks).trim() || href || "";
    if (!href || !label) return wrapMarks(label, inherited, marks);
    return wrapMarks(`[${escapeLinkLabel(label)}](${href})`, inherited, {
      ...marks,
      bold: inherited.bold,
      italic: inherited.italic,
      strike: inherited.strike,
      underline: inherited.underline,
      code: inherited.code,
    });
  }
  if (tag === "code" || tag === "kbd" || tag === "samp") {
    const text = (element.textContent ?? "").replace(/`/gu, "\\`");
    return wrapMarks(`\`${text}\``, inherited, { ...marks, code: inherited.code });
  }
  return wrapMarks(convertInlines(element, marks), inherited, marks);
}

function convertText(value: string, marks: InlineMarks): string {
  const text = value
    .replace(/\u00a0/gu, " ")
    .replace(/\r\n?/gu, "\n");
  if (!text) return "";
  if (marks.code) return text;
  return escapeMarkdownInline(text);
}

function containsBlock(element: Element): boolean {
  for (const child of Array.from(element.childNodes)) {
    if (!(child instanceof Element)) continue;
    const tag = child.tagName.toLowerCase();
    if (blockTags.has(tag)) return true;
    if (containsBlock(child)) return true;
  }
  return false;
}

function wrapMarks(text: string, before: InlineMarks, after: InlineMarks): string {
  if (!text) return "";
  let result = text;
  if (!before.code && after.code) result = `\`${result}\``;
  if (!before.bold && after.bold) result = `**${result}**`;
  if (!before.italic && after.italic) result = `*${result}*`;
  if (!before.strike && after.strike) result = `~~${result}~~`;
  if (!before.underline && after.underline) result = `<u>${result}</u>`;
  return result;
}

function marksFromElement(element: Element, inherited: InlineMarks): InlineMarks {
  const tag = element.tagName.toLowerCase();
  const css = element.getAttribute("style") ?? "";
  const next = { ...inherited };
  const fontWeight = cssProperty(css, "font-weight");
  const fontStyle = cssProperty(css, "font-style");
  const decoration = `${cssProperty(css, "text-decoration")} ${cssProperty(css, "text-decoration-line")}`;

  if (fontWeight === "normal" || fontWeight === "400") next.bold = false;
  else if (fontWeight === "bold" || Number.parseInt(fontWeight, 10) >= 600) {
    next.bold = true;
  } else if (tag === "b" || tag === "strong") {
    next.bold = true;
  }

  if (fontStyle === "normal") next.italic = false;
  else if (fontStyle === "italic" || tag === "i" || tag === "em") next.italic = true;

  if (/\bnone\b/iu.test(decoration)) {
    next.underline = false;
    next.strike = false;
  }
  if (tag === "u" || tag === "ins" || /underline/iu.test(decoration)) {
    next.underline = true;
  }
  if (
    tag === "s" ||
    tag === "strike" ||
    tag === "del" ||
    /line-through/iu.test(decoration)
  ) {
    next.strike = true;
  }
  if (tag === "code" || tag === "kbd" || tag === "samp") next.code = true;
  return next;
}

function cssProperty(style: string, name: string) {
  const match = style.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "iu"));
  return match?.[1]?.trim() ?? "";
}

function msoListInfo(element: Element) {
  if (!(element instanceof HTMLElement)) return null;
  const style = `${element.getAttribute("style") ?? ""};${element.style.cssText}`;
  const match = style.match(/mso-list\s*:\s*\S+\s+level(\d+)/iu);
  if (!match) return null;
  const level = Math.max(0, Number(match[1]) - 1);
  const marker = msoListMarker(element);
  const ordered = marker ? /^\d|^[a-z]/iu.test(marker) && !/^[•·o○■-]/u.test(marker) : true;
  return { level, ordered };
}

function msoListMarker(element: Element) {
  const ignored = element.querySelector("[style*='mso-list:Ignore' i], [style*='mso-list: Ignore' i]");
  return ignored?.textContent?.trim() ?? "";
}

function stripMsoIgnore(element: Element) {
  const clone = element.cloneNode(true) as Element;
  for (const ignored of Array.from(
    clone.querySelectorAll("[style*='mso-list:Ignore' i], [style*='mso-list: Ignore' i]"),
  )) {
    ignored.remove();
  }
  return clone;
}

function convertTable(table: Element, marks: InlineMarks): string {
  const rows = Array.from(table.querySelectorAll("tr"));
  return rows
    .map((row) =>
      Array.from(row.children)
        .filter((cell) => {
          const tag = cell.tagName.toLowerCase();
          return tag === "td" || tag === "th";
        })
        .map((cell) => convertInlines(cell, marks).trim())
        .join(" \t "),
    )
    .filter(Boolean)
    .join("\n");
}

function safeHref(value: string | null): string | null {
  const href = value?.trim();
  if (!href) return null;
  try {
    const url = new URL(href, href.startsWith("http") ? undefined : "https://invalid.local");
    if (href.startsWith("mailto:")) {
      return url.protocol === "mailto:" ? href : null;
    }
    if (!allowedLinkProtocols.has(url.protocol)) return null;
    if (!/^https?:\/\//iu.test(href) && !href.startsWith("mailto:")) return null;
    return href.replace(/[()\s]/gu, encodeURIComponent);
  } catch {
    return null;
  }
}

function escapeMarkdownInline(value: string) {
  return value.replace(/([\\`*_[\]~])/gu, "\\$1");
}

function escapeLinkLabel(value: string) {
  return value.replace(/[[\]]/gu, "\\$&");
}

function hardBreak() {
  return "  \n";
}

function stripTrailingLineSpace(value: string) {
  return value.replace(/[ \t]+\n/gu, (match) => match === "  \n" ? "  \n" : "\n");
}

function normalizeMarkdown(value: string) {
  return stripTrailingLineSpace(value.replace(/\r\n?/gu, "\n"))
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
