type IssueMentionNode = {
  type: string;
  value?: string;
  children?: IssueMentionNode[];
  [key: string]: unknown;
};

type IssueMentionTree = IssueMentionNode & {
  children: IssueMentionNode[];
};

export const issueMentionUrlPrefix = "briar-mention://";

const mentionPattern =
  /(^|[^\p{L}\p{N}_.-])(@[\p{L}\p{N}_-](?:[\p{L}\p{N}_.-]*[\p{L}\p{N}_-])?)(?=$|[^\p{L}\p{N}_-])/gu;
const nonTextualNodeTypes = new Set([
  "code",
  "definition",
  "image",
  "imageReference",
  "inlineCode",
  "link",
  "linkReference",
]);

export function issueMentionUrl(handle: string) {
  return `${issueMentionUrlPrefix}${encodeURIComponent(handle)}`;
}

export function isIssueMentionUrl(url: string | null | undefined) {
  return typeof url === "string" && url.startsWith(issueMentionUrlPrefix);
}

export function issueMentionHandleFromUrl(
  url: string | null | undefined,
) {
  if (typeof url !== "string" || !isIssueMentionUrl(url)) return null;
  try {
    return decodeURIComponent(url.slice(issueMentionUrlPrefix.length));
  } catch {
    return null;
  }
}

function splitTextNode(node: IssueMentionNode, handles: Set<string>) {
  if (typeof node.value !== "string") return [node];

  const children: IssueMentionNode[] = [];
  let cursor = 0;
  let changed = false;
  const matcher = new RegExp(mentionPattern.source, mentionPattern.flags);

  for (const match of node.value.matchAll(matcher)) {
    const mention = match[2];
    if (!mention || !handles.has(mention.slice(1).toLowerCase())) continue;

    const matchStart = match.index ?? 0;
    const mentionStart = matchStart + match[1].length;
    if (mentionStart > cursor) {
      children.push({
        ...node,
        value: node.value.slice(cursor, mentionStart),
      });
    }
    children.push({
      type: "link",
      title: null,
      url: issueMentionUrl(mention.slice(1)),
      children: [{ type: "text", value: mention }],
    });
    cursor = mentionStart + mention.length;
    changed = true;
  }

  if (!changed) return [node];
  if (cursor < node.value.length) {
    children.push({
      ...node,
      value: node.value.slice(cursor),
    });
  }
  return children;
}

function transformIssueMentionNode(
  node: IssueMentionNode | null | undefined,
  handles: Set<string>,
) {
  if (!node || nonTextualNodeTypes.has(node.type) || !node.children) return;

  node.children = node.children.flatMap((child) => {
    if (!child) return [];
    if (child.type === "text") return splitTextNode(child, handles);
    transformIssueMentionNode(child, handles);
    return [child];
  });
}

export function remarkIssueMentions(handles: readonly string[]) {
  const normalizedHandles = new Set(
    handles
      .map((handle) => handle.replace(/^@/u, "").toLowerCase())
      .filter(Boolean),
  );

  return function issueMentionPlugin() {
    return (tree: IssueMentionTree) => {
      transformIssueMentionNode(tree, normalizedHandles);
    };
  };
}
