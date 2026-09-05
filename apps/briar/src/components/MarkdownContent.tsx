import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
  type Options,
} from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { remarkUnderline } from "../lib/remark-underline";

const defaultComponents: Components = {
  table: ({ children, node: _node, ...props }) => (
    <div className="markdown-table-wrap">
      <table {...props}>{children}</table>
    </div>
  ),
  u: ({ children }) => <u>{children}</u>,
};

export function MarkdownContent({
  children,
  className,
  components,
  remarkPlugins = [],
  urlTransform = defaultUrlTransform,
}: {
  children: string;
  className?: string;
  components?: Components;
  remarkPlugins?: Exclude<Options["remarkPlugins"], null>;
  urlTransform?: Options["urlTransform"];
}) {
  const classes = [className, "markdown-content"].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <ReactMarkdown
        components={{ ...defaultComponents, ...components }}
        remarkPlugins={[remarkGfm, remarkBreaks, remarkUnderline, ...remarkPlugins]}
        skipHtml
        urlTransform={urlTransform}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export { defaultUrlTransform as defaultMarkdownUrlTransform };
