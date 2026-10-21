import type { ElementData } from "./protocol";

// Keep the editor boundary aligned with ElementValidation's persisted drawing fields.
const drawingFields = new Set(
  (
    "id type x y width height angle strokeColor backgroundColor fillStyle strokeWidth strokeStyle roughness opacity " +
    "groupIds frameId index roundness seed version versionNonce isDeleted boundElements locked text originalText fontSize fontFamily " +
    "textAlign verticalAlign containerId autoResize lineHeight points lastCommittedPoint startBinding endBinding startArrowhead endArrowhead " +
    "elbowed fixedSegments startIsSpecial endIsSpecial pressures simulatePressure fileId status scale crop"
  ).split(" ")
);

export function normalizeElement(element: ElementData): ElementData {
  return Object.fromEntries(Object.entries(element).filter(([key]) => drawingFields.has(key))) as ElementData;
}

export function elementFingerprint(element: ElementData | undefined): string {
  if (!element) return "";
  return JSON.stringify(normalizeElement(element), (_key, value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, record[key]])
      );
    }
    return value;
  });
}

/** Pure reconciliation helpers; tested without a browser or Excalidraw. */
export function indexById(elements: readonly ElementData[]): Map<string, ElementData> {
  return new Map(elements.map((item) => [item.id, item]));
}

export function changedElements(
  elements: readonly ElementData[],
  baseline: ReadonlyMap<string, string>
): ElementData[] {
  return elements.filter(
    (item) =>
      elementFingerprint(item) !==
      elementFingerprint(
        baseline.has(item.id) ? (JSON.parse(baseline.get(item.id)!) as ElementData) : undefined
      )
  );
}

export function mergeById(current: readonly ElementData[], incoming: readonly ElementData[]): ElementData[] {
  const result = indexById(current);
  for (const item of incoming) result.set(item.id, item);
  return [...result.values()].sort((a, b) => {
    if (typeof a.index !== "string" || typeof b.index !== "string") return 0;
    return a.index < b.index ? -1 : a.index > b.index ? 1 : a.id.localeCompare(b.id);
  });
}

/** Public objects are locked during poker; private objects can be changed until reveal. */
export function restoreLockedPublic(
  actual: readonly ElementData[],
  published: ReadonlyMap<string, ElementData>
): { elements: ElementData[]; reverted: boolean } {
  let reverted = false;
  const actualMap = indexById(actual);
  for (const [id, original] of published) {
    if (elementFingerprint(actualMap.get(id)) !== elementFingerprint(original)) {
      actualMap.set(id, original);
      reverted = true;
    }
  }
  return { elements: [...actualMap.values()], reverted };
}
