import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  PanelsTopLeft,
  LayoutGrid,
  UserRound,
  UsersRound,
  Bookmark,
  Plus,
  Search,
  Menu,
  LogOut,
} from "lucide-react";
import { signIn, type Account } from "./api";
import { useCanvasList } from "./useCanvasList";
import CanvasCard from "./CanvasCard";
import DashboardDialogs, { type DashboardDialog } from "./DashboardDialogs";

export default function Dashboard({ user }: { user: Account }) {
  const [params, setParams] = useSearchParams();
  const filter = ["mine", "shared", "templates"].includes(params.get("filter") ?? "")
    ? params.get("filter")!
    : "all";
  const sort = params.get("sort") === "name" ? "name" : "recent";
  const query = params.get("q") ?? "";
  const [search, setSearch] = useState(query);
  const [notice, setNotice] = useState("");
  const [mobile, setMobile] = useState(false);
  const [dialog, setDialog] = useState<DashboardDialog | null>(null);
  const { page, cursor, setPage, refresh, loading, error, loadMore } = useCanvasList({
    filter,
    sort,
    query,
    refreshOnFocus: true,
  });
  const scrollKey = `dashboard-scroll:${params}`;
  const restoredScroll = useRef("");
  useLayoutEffect(() => {
    if (loading || cursor || restoredScroll.current === scrollKey) return;
    restoredScroll.current = scrollKey;
    const position = Number(sessionStorage.getItem(scrollKey) ?? 0);
    if (Number.isFinite(position)) window.scrollTo(0, position);
  }, [loading, cursor, scrollKey]);
  useEffect(() => {
    const remember = () => {
      if (!loading) sessionStorage.setItem(scrollKey, String(window.scrollY));
    };
    window.addEventListener("scroll", remember, { passive: true });
    return () => window.removeEventListener("scroll", remember);
  }, [loading, scrollKey]);
  function change(key: string, value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }
  useEffect(() => {
    setSearch(query);
  }, [query, filter, sort]);
  useEffect(() => {
    if (search === query) return;
    const timer = setTimeout(() => change("q", search), 300);
    return () => clearTimeout(timer);
  }, [search, query]);
  const title =
    filter === "mine"
      ? "My canvases"
      : filter === "shared"
        ? "Shared with me"
        : filter === "templates"
          ? "Templates"
          : "All canvases";
  return (
    <div className="shell min-h-screen bg-slate-50 text-slate-900">
      <button
        className="button dashboard-nav-toggle fixed top-4 left-4 z-20 md:hidden"
        aria-label="Toggle navigation"
        aria-expanded={mobile}
        aria-controls="canvas-navigation"
        onClick={() => setMobile(!mobile)}
      >
        <Menu size={20} />
      </button>
      <aside
        id="canvas-navigation"
        onKeyDown={(e) => {
          if (e.key === "Escape") setMobile(false);
        }}
        className={`${mobile ? "flex" : "hidden"} md:flex fixed inset-y-0 left-0 w-60 bg-white border-r border-slate-200 z-10 flex-col p-5`}
      >
        <Link
          to="/"
          className="flex gap-3 items-center font-semibold text-lg mt-14 md:mt-3 mb-12 no-underline text-slate-900"
        >
          <PanelsTopLeft size={26} className="text-blue-600" />
          Team Canvas
        </Link>
        <nav aria-label="Canvases" className="space-y-2">
          {(
            [
              ["all", "All canvases", LayoutGrid],
              ["mine", "My canvases", UserRound],
              ["shared", "Shared with me", UsersRound],
              ["templates", "Templates", Bookmark],
            ] as const
          ).map(([value, label, Icon]) => (
            <Link
              key={value}
              to={value === "all" ? "/" : `/?filter=${value}`}
              onClick={() => setMobile(false)}
              aria-current={filter === value ? "page" : undefined}
              className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium no-underline ${filter === value ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <Icon size={18} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t border-slate-200 pt-5">
          <div className="flex gap-3 items-center">
            <span className="rounded-full bg-slate-100 w-9 h-9 flex items-center justify-center font-medium">
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate text-sm font-medium">{user.displayName}</span>
          </div>
          <Link to="/logout" className="flex items-center gap-2 text-sm text-slate-500 mt-4 no-underline">
            <LogOut size={16} />
            Sign out
          </Link>
        </div>
      </aside>
      <main className="md:ml-60 px-6 pt-24 pb-12 md:px-12 md:pt-12 max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-5 mb-9">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight m-0">{title}</h1>
            <p className="text-slate-500 text-sm mt-3">Your space to think together.</p>
          </div>
          <button className="button primary" onClick={() => setDialog({ type: "create" })}>
            <Plus size={18} />
            New canvas
          </button>
        </header>
        <div className="flex flex-wrap justify-between gap-4 mb-7">
          <label className="relative flex-1 max-w-md">
            <span className="sr-only">Search canvases or tags</span>
            <Search size={18} className="absolute top-3 left-3 text-slate-400" />
            <input
              className="field w-full pl-10"
              type="search"
              placeholder="Search canvases or tags…"
              value={search}
              maxLength={120}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-500">
            Sort by
            <select className="field" value={sort} onChange={(e) => change("sort", e.target.value)}>
              <option value="recent">Recently opened</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
        {notice && (
          <p role="status" className="text-sm text-slate-600">
            {notice}
          </p>
        )}
        {error && (
          <div role="alert" className="error">
            {error}{" "}
            <button className="button" onClick={() => refresh()}>
              Retry
            </button>
            <button className="button ml-2" onClick={signIn}>
              Sign in again
            </button>
          </div>
        )}
        {loading && !cursor ? (
          <div role="status" className="grid lg:grid-cols-2 gap-5">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="h-36 rounded-xl bg-slate-200 animate-pulse" />
            ))}
            <span className="sr-only">Loading canvases</span>
          </div>
        ) : !page.items.length && !error ? (
          <div className="text-center py-20 border border-dashed border-slate-300 rounded-xl bg-white">
            <PanelsTopLeft size={36} className="mx-auto text-slate-400" />
            <h2 className="text-lg font-semibold mt-5">
              {query
                ? "No matching canvases"
                : filter === "shared"
                  ? "Nothing shared with you yet"
                  : filter === "templates"
                    ? "No templates available"
                    : "Make room for your next idea"}
            </h2>
            <p className="text-slate-500 text-sm mb-5">
              {query
                ? "Try a different name or clear your search."
                : filter === "shared"
                  ? "Accept an invitation link to see a canvas here."
                  : filter === "templates"
                    ? "Public templates and your private templates will appear here. Mark one of your canvases as a template from its actions menu."
                    : "Create your first canvas and invite your team."}
            </p>
            {query ? (
              <button
                className="button"
                onClick={() => {
                  setSearch("");
                  change("q", "");
                }}
              >
                Clear search
              </button>
            ) : (
              filter !== "shared" &&
              filter !== "templates" && (
                <button className="button primary" onClick={() => setDialog({ type: "create" })}>
                  New canvas
                </button>
              )
            )}
          </div>
        ) : (
          <div className="grid lg:grid-cols-2 gap-5">
            {page.items.map((canvas) => (
              <CanvasCard
                key={canvas.id}
                canvas={canvas}
                filter={filter}
                dashboard={`/?${params}`}
                onAction={setDialog}
              />
            ))}
          </div>
        )}
        {page.nextCursor && !error && (
          <div className="text-center mt-8">
            <button className="button" disabled={loading} onClick={() => loadMore()}>
              {loading ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </main>
      <DashboardDialogs
        dialog={dialog}
        dashboard={`/?${params}`}
        close={() => setDialog(null)}
        refresh={refresh}
        setPage={setPage}
        notify={setNotice}
      />
    </div>
  );
}
