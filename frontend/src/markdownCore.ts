export const MARKDOWN_LINK = "https://team-canvas.invalid/markdown";
export const MARKDOWN_LIMIT = 10_000;

export function markdownSource(element: { type: string; customData?: unknown }): string | null {
  const data = element.customData as { teamCanvasKind?: unknown; markdown?: unknown } | undefined;
  return element.type === "embeddable" && data?.teamCanvasKind === "markdown" &&
    typeof data.markdown === "string" && data.markdown.length <= MARKDOWN_LIMIT ? data.markdown : null;
}
