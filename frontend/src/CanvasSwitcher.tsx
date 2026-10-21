import { useState } from "react";
import { Link } from "react-router-dom";
import { Modal } from "./ui";
import { useCanvasList } from "./useCanvasList";

export default function CanvasSwitcher({ current, close }: { current: string; close: () => void }) {
  const [query, setQuery] = useState("");
  const { page, loading, error, loadMore } = useCanvasList({ query, debounceMs: 200 });
  return (
    <Modal title="Switch canvas" close={close}>
      <label htmlFor="switch-search" className="sr-only">
        Search canvases or tags
      </label>
      <input
        autoFocus
        id="switch-search"
        type="search"
        className="field w-full"
        placeholder="Search canvases or tags…"
        maxLength={120}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
        }}
      />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="max-h-80 overflow-auto mt-4">
        {!loading && !page.items.length && <p>No matching canvases.</p>}
        {page.items.map((canvas) => (
          <Link
            key={canvas.id}
            to={`/b/${canvas.id}`}
            aria-current={canvas.id === current ? "page" : undefined}
            onClick={close}
            className="block p-3 rounded-lg text-slate-700 no-underline hover:bg-blue-50"
          >
            <span className="font-medium">{canvas.name}</span>
            <span className="block text-xs text-slate-500">
              {canvas.id === current
                ? "Current canvas"
                : canvas.relationship === "owner"
                  ? "Owned by you"
                  : `Shared by ${canvas.owner.displayName}`}
            </span>
            {canvas.tags.length > 0 && (
              <span className="flex flex-wrap gap-1 mt-2">
                {canvas.tags.map((tag) => (
                  <span key={tag} className="tag-chip">
                    {tag}
                  </span>
                ))}
              </span>
            )}
          </Link>
        ))}
      </div>
      {loading && (
        <p role="status" className="text-sm mt-3">
          Loading canvases…
        </p>
      )}
      {page.nextCursor && (
        <button className="button mt-3" disabled={loading} onClick={() => loadMore()}>
          Load more
        </button>
      )}
    </Modal>
  );
}
