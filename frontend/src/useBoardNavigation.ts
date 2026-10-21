import { useEffect } from "react";
import { useBlocker } from "react-router-dom";
import type { SessionView } from "./syncSession";
import { downloadDraft as exportDraft } from "./draftExport";

export function useBoardNavigation(view: SessionView, deleted: boolean, recoveryExported: () => void) {
  const round = view.snapshot?.round;
  const unfinished = !deleted && !!round?.included && !round.done;
  const waiting = !deleted && view.busy;
  const blocker = useBlocker(view.unsaved || waiting || view.recovery.length > 0 || unfinished);
  useEffect(() => {
    if (blocker.state === "blocked" && !view.unsaved && !waiting && !view.recovery.length && !unfinished)
      blocker.proceed();
  }, [blocker, view.unsaved, waiting, view.recovery.length, unfinished]);

  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (view.unsaved || waiting || view.recovery.length > 0 || unfinished) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [view.unsaved, waiting, view.recovery.length, unfinished]);

  const downloadDraft = (recovered = false) => {
    exportDraft(view, recovered);
    if (recovered) recoveryExported();
  };
  return { blocker, downloadDraft, unfinished, waiting };
}
