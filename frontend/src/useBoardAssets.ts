import { useEffect } from "react";
import { fetchAsset } from "./api";
import type { ElementData, Files } from "./protocol";
import type { SyncSession } from "./syncSession";

/** Bounded downloads are cancelled when the visible page or canvas changes. */
export function useBoardAssets(
  boardId: string,
  token: string,
  online: boolean,
  elements: ElementData[],
  files: Files,
  controller: SyncSession
) {
  const missingAssetsKey = JSON.stringify(
    [
      ...new Set(
        elements
          .filter((el) => el.type === "image" && !el.isDeleted)
          .map((el) => String(el.fileId ?? ""))
          .filter((id) => id && !files[id])
      ),
    ].sort()
  );
  useEffect(() => {
    if (!online) return;
    const abort = new AbortController();
    const ids = JSON.parse(missingAssetsKey) as string[];
    const loaded: Files = {};
    let cursor = 0;
    async function worker() {
      while (cursor < ids.length && !abort.signal.aborted) {
        const id = ids[cursor++];
        try {
          const file = await fetchAsset(boardId, id, token, abort.signal);
          if (!abort.signal.aborted) loaded[id] = file;
        } catch (error) {
          if (!abort.signal.aborted)
            controller.reportError(error instanceof Error ? error.message : "Could not load image.");
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker)).then(() => {
      if (!abort.signal.aborted && Object.keys(loaded).length) controller.addFiles(loaded);
    });
    return () => abort.abort();
  }, [boardId, token, online, missingAssetsKey, controller]);
}
