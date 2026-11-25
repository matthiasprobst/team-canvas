import { memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const plugins = [remarkGfm];
function safeUrl(value: string) {
  if (value.startsWith("#")) return value;
  try { return ["https:", "http:", "mailto:"].includes(new URL(value).protocol) ? value : ""; }
  catch { return ""; }
}

// Render source as React nodes: no raw HTML, remote images, or embedded scripts.
export default memo(function MarkdownContent({ source }: { source: string }) {
  return <div className="markdown-content"><Markdown remarkPlugins={plugins} skipHtml urlTransform={safeUrl}
    components={{
      a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()}>{children}</a> : <span>{children}</span>,
      img: ({ alt }) => <span className="markdown-image-label">{alt ? `[Image: ${alt}]` : "[Image]"}</span>,
    }}>{source}</Markdown></div>;
});
