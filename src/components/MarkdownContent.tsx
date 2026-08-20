import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
  type Options,
} from "react-markdown";
import remarkGfm from "remark-gfm";

const defaultComponents: Components = {
  table: ({ children, node: _node, ...props }) => (
    <div className="markdown-table-wrap">
      <table {...props}>{children}</table>
    </div>
  ),
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
        remarkPlugins={[remarkGfm, ...remarkPlugins]}
        skipHtml
        urlTransform={urlTransform}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export { defaultUrlTransform as defaultMarkdownUrlTransform };
