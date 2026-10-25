import { useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PanelsTopLeft, MoreHorizontal, ArrowUpRight, Pencil } from "lucide-react";
import type { Canvas } from "./api";
import type { DashboardDialog } from "./DashboardDialogs";

export default function CanvasCard({
  canvas,
  filter,
  dashboard,
  onAction,
}: {
  canvas: Canvas;
  filter: string;
  dashboard: string;
  onAction: (dialog: DashboardDialog) => void;
}) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const navigate = useNavigate();
  return (
    <article className="group relative min-w-0 rounded-xl border border-slate-200 bg-white p-6 hover:border-blue-300 transition-colors">
      <div className="flex justify-between gap-3">
        <span className="flex items-center justify-center rounded-lg w-10 h-10 bg-blue-50 text-blue-600">
          <PanelsTopLeft size={21} />
        </span>
        {canvas.relationship === "owner" && (
          <details ref={menuRef} className="relative">
            <summary
              className="icon-button list-none cursor-pointer"
              aria-label={`Actions for ${canvas.name}`}
            >
              <MoreHorizontal size={20} />
            </summary>
            <div className="absolute right-0 top-9 z-10 bg-white border border-slate-200 rounded-lg shadow-lg p-1 min-w-32">
              <button
                className="menu-item"
                onClick={() => {
                  if (menuRef.current) menuRef.current.open = false;
                  onAction({ type: "rename", canvas });
                }}
              >
                Rename
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  if (menuRef.current) menuRef.current.open = false;
                  onAction({ type: "share", canvas });
                }}
              >
                Share
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  if (menuRef.current) menuRef.current.open = false;
                  onAction({ type: "tags", canvas });
                }}
              >
                Manage tags
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  if (menuRef.current) menuRef.current.open = false;
                  onAction({ type: "template", canvas });
                }}
              >
                {canvas.templateVisibility ? "Template settings" : "Make template"}
              </button>
              <button
                className="menu-item text-red-700"
                onClick={() => {
                  if (menuRef.current) menuRef.current.open = false;
                  onAction({ type: "delete", canvas });
                }}
              >
                Delete
              </button>
            </div>
          </details>
        )}
      </div>
      {filter === "templates" ? (
        <h2 className="mt-4 font-semibold text-slate-900 truncate">{canvas.name}</h2>
      ) : (
        <Link
          to={`/b/${canvas.id}`}
          state={{ dashboard: dashboard }}
          className="mt-4 flex items-center justify-between font-semibold text-slate-900 no-underline hover:text-blue-700"
        >
          <span className="truncate">{canvas.name}</span>
          <ArrowUpRight size={18} className="text-slate-400 shrink-0" />
        </Link>
      )}
      <p className="text-sm text-slate-500 mt-2 mb-5 truncate">
        {filter === "templates"
          ? `${canvas.templateVisibility === "public" ? "Public" : "Private"} template by ${canvas.owner.displayName}`
          : canvas.relationship === "owner"
            ? canvas.templateVisibility
              ? `${canvas.templateVisibility === "public" ? "Public" : "Private"} template · Owned by you`
              : "Owned by you"
            : `Shared by ${canvas.owner.displayName}`}
      </p>
      <p className="text-xs text-slate-400 m-0">
        {canvas.lastOpenedAt
          ? `Last opened ${new Date(canvas.lastOpenedAt).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}`
          : "Not opened yet"}
      </p>
      {canvas.tags.length > 0 && (
        <div aria-label="Canvas tags" className="flex flex-wrap gap-1 mt-3">
          {canvas.tags.map((tag) => (
            <span key={tag} className="tag-chip">
              {tag}
            </span>
          ))}
        </div>
      )}
      {filter === "templates" && (
        <div className="flex flex-wrap gap-2 mt-4">
          {canvas.relationship === "owner" && (
            <button
              className="button"
              onClick={() => navigate(`/b/${canvas.id}`, { state: { dashboard: `/?filter=templates` } })}
            >
              <Pencil size={16} />
              Edit template
            </button>
          )}
          <button className="button primary" onClick={() => onAction({ type: "start-template", canvas })}>
            Start template
          </button>
        </div>
      )}
    </article>
  );
}
