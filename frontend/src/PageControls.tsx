import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { Snapshot } from "./protocol";
import { Modal } from "./ui";

export default function PageControls({
  snapshot,
  online,
  busy,
  createPage,
  selectPage,
}: {
  snapshot: Snapshot | null;
  online: boolean;
  busy: boolean;
  createPage: (copyCurrent: boolean, includePoker: boolean) => void;
  selectPage: (pageId: string) => void;
}) {
  const [pageDialog, setPageDialog] = useState(false);
  const [copyPageContent, setCopyPageContent] = useState(true);
  const [includePokerContent, setIncludePokerContent] = useState(false);
  const poker = snapshot?.board.mode === "poker";
  const pageIndex = snapshot?.pages.findIndex((page) => page.id === snapshot.board.pageId) ?? -1;
  const step = (direction: number) => {
    const target = snapshot?.pages[pageIndex + direction];
    if (target) selectPage(target.id);
  };
  return (
    <>
      {pageDialog && (
        <Modal title="Create next page" close={() => setPageDialog(false)}>
          <p className="text-sm text-slate-600">
            Create a page from the current canvas or start with a blank page.
          </p>
          <label className="flex gap-2 items-center text-sm mt-4">
            <input
              type="checkbox"
              checked={copyPageContent}
              onChange={(event) => setCopyPageContent(event.target.checked)}
            />
            Copy current page content
          </label>
          <label className="flex gap-2 items-center text-sm mt-3">
            <input
              type="checkbox"
              checked={includePokerContent}
              disabled={!copyPageContent || !snapshot?.pokerCreatedIds.length}
              onChange={(event) => setIncludePokerContent(event.target.checked)}
            />
            Include drawings created during poker ({snapshot?.pokerCreatedIds.length ?? 0})
          </label>
          <div className="flex justify-end gap-3 mt-6">
            <button className="button" onClick={() => setPageDialog(false)}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={!online || busy || poker}
              onClick={() => {
                createPage(copyPageContent, includePokerContent);
                setPageDialog(false);
              }}
            >
              Create page
            </button>
          </div>
        </Modal>
      )}
      <div className="page-tools">
        <span className="page-caption">PAGE</span>
        {snapshot && (
          <div className="page-picker">
            <button
              className="page-step"
              aria-label="Previous page"
              disabled={!online || busy || poker || pageIndex <= 0}
              onClick={() => {
                step(-1);
              }}
            >
              <ChevronLeft size={17} />
            </button>
            <select
              aria-label="Canvas page"
              value={snapshot.board.pageId}
              disabled={!online || busy || poker}
              onChange={(event) => selectPage(event.target.value)}
            >
              {snapshot.pages.map((page, index) => (
                <option key={page.id} value={page.id}>
                  Page {index + 1}
                </option>
              ))}
            </select>
            <span className="page-count">
              {pageIndex + 1}
              <i>/</i>
              {snapshot.pages.length}
            </span>
            <button
              className="page-step"
              aria-label="Next page"
              disabled={!online || busy || poker || pageIndex >= snapshot.pages.length - 1}
              onClick={() => {
                step(1);
              }}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        )}
        <button
          className="new-page-button"
          disabled={!online || busy || poker}
          onClick={() => {
            setCopyPageContent(true);
            setIncludePokerContent(false);
            setPageDialog(true);
          }}
        >
          <Plus size={16} />
          <span>New page</span>
        </button>
      </div>
    </>
  );
}
