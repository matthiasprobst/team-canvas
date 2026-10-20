import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PanelsTopLeft, LayoutGrid, UserRound, UsersRound, Bookmark, Plus, Search, MoreHorizontal, ArrowUpRight, Menu, LogOut, Pencil } from "lucide-react";
import { request, createBoard, renameBoard, deleteBoard, setTemplateVisibility, removeTemplate, startTemplate, setCanvasTags, signIn, type Account, type Canvas, type CanvasPage, type TemplateVisibility } from "./api";
import { me, uploadAvatar, removeAvatar } from "./api";
import AvatarView from "./AvatarView";
import { errorMessage, NameDialog, ShareDialog, DeleteCanvasDialog, TemplateDialog, TagDialog } from "./ui";

export default function Dashboard({ user }: { user: Account }) {
  const [params, setParams] = useSearchParams();
  const filter = ["mine", "shared", "templates"].includes(params.get("filter") ?? "") ? params.get("filter")! : "all";
  const sort = params.get("sort") === "name" ? "name" : "recent";
  const query = params.get("q") ?? "";
  const [search, setSearch] = useState(query);
  const [page, setPage] = useState<CanvasPage>({ items: [], nextCursor: null });
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [mobile, setMobile] = useState(false);
  const [avatarVersion, setAvatarVersion] = useState(user.avatarVersion);
  const [hasAvatar, setHasAvatar] = useState(user.hasAvatar);
  const [avatarError, setAvatarError] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<{ type: "create" | "rename" | "share" | "delete" | "template" | "start-template" | "tags"; canvas?: Canvas } | null>(null);
  const navigate = useNavigate();
  async function setProfileImage(file?: File) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || file.size > 1_048_576) {
      setAvatarError("Choose a PNG, JPEG, WebP, or GIF image up to 1 MB.");
      return;
    }
    setAvatarBusy(true); setAvatarError("");
    try {
      const dataURL = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read image."));
        reader.onerror = () => reject(new Error("Could not read image."));
        reader.readAsDataURL(file);
      });
      await uploadAvatar(file.type, dataURL);
      const profile = await me();
      setAvatarVersion(profile.avatarVersion); setHasAvatar(profile.hasAvatar);
    } catch (error) { setAvatarError(error instanceof Error ? error.message : "Could not update avatar."); }
    finally { setAvatarBusy(false); if (avatarInput.current) avatarInput.current.value = ""; }
  }
  const scrollKey = `dashboard-scroll:${params}`;
  const restoredScroll = useRef("");
  useLayoutEffect(() => {
    if (loading || cursor || restoredScroll.current === scrollKey) return;
    restoredScroll.current = scrollKey;
    const position = Number(sessionStorage.getItem(scrollKey) ?? 0);
    if (Number.isFinite(position)) window.scrollTo(0, position);
  }, [loading, cursor, scrollKey]);
  useEffect(() => {
    const remember = () => { if (!loading) sessionStorage.setItem(scrollKey, String(window.scrollY)); };
    window.addEventListener("scroll", remember, { passive: true });
    return () => window.removeEventListener("scroll", remember);
  }, [loading, scrollKey]);
  function change(key: string, value: string) { setParams(current => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); return next; }); setCursor(null); }
  useEffect(() => { setSearch(query); setCursor(null); }, [query, filter, sort]);
  useEffect(() => { if (search === query) return; const timer = setTimeout(() => change("q", search), 300); return () => clearTimeout(timer); }, [search, query]);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError("");
    const values = new URLSearchParams({ filter, sort, q: query, limit: "24" });
    if (cursor) values.set("cursor", cursor);
    void request<CanvasPage>(`/api/boards?${values}`, undefined, "GET", abort.signal).then(result => {
      setPage(previous => ({ items: cursor ? [...previous.items, ...result.items.filter(item => !previous.items.some(old => old.id === item.id))] : result.items, nextCursor: result.nextCursor }));
    }).catch(e => { if (!abort.signal.aborted) setError(errorMessage(e)); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [filter, sort, query, cursor, refresh]);
  useEffect(() => {
    const refreshList = () => { setCursor(null); setRefresh(n => n + 1); };
    window.addEventListener("focus", refreshList);
    return () => window.removeEventListener("focus", refreshList);
  }, []);
  const title = filter === "mine" ? "My canvases" : filter === "shared" ? "Shared with me" : filter === "templates" ? "Templates" : "All canvases";
  return <div className="shell min-h-screen bg-slate-50 text-slate-900">
    <button className="button dashboard-nav-toggle fixed top-4 left-4 z-20 md:hidden" aria-label="Toggle navigation" aria-expanded={mobile} aria-controls="canvas-navigation" onClick={() => setMobile(!mobile)}><Menu size={20} /></button>
    <aside id="canvas-navigation" onKeyDown={e => { if (e.key === "Escape") setMobile(false); }} className={`${mobile ? "flex" : "hidden"} md:flex fixed inset-y-0 left-0 w-60 bg-white border-r border-slate-200 z-10 flex-col p-5`}>
      <Link to="/" className="flex gap-3 items-center font-semibold text-lg mt-14 md:mt-3 mb-12 no-underline text-slate-900"><PanelsTopLeft size={26} className="text-blue-600" />Team Canvas</Link>
      <nav aria-label="Canvases" className="space-y-2">{([["all", "All canvases", LayoutGrid], ["mine", "My canvases", UserRound], ["shared", "Shared with me", UsersRound], ["templates", "Templates", Bookmark]] as const).map(([value, label, Icon]) =>
        <Link key={value} to={value === "all" ? "/" : `/?filter=${value}`} onClick={() => setMobile(false)} aria-current={filter === value ? "page" : undefined} className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium no-underline ${filter === value ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"}`}><Icon size={18} />{label}</Link>)}</nav>
      <div className="mt-auto border-t border-slate-200 pt-5">
        <div className="flex gap-3 items-center"><AvatarView userId={user.id} name={user.displayName} version={avatarVersion} hasAvatar={hasAvatar} /><span className="truncate text-sm font-medium">{user.displayName}</span></div>
        <input ref={avatarInput} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => void setProfileImage(event.target.files?.[0])} />
        <div className="flex gap-3 mt-2"><button className="text-action text-xs" disabled={avatarBusy} onClick={() => avatarInput.current?.click()}>{avatarBusy ? "Saving…" : "Change avatar"}</button>
          {hasAvatar && <button className="text-action text-xs muted" disabled={avatarBusy} onClick={() => { setAvatarBusy(true); setAvatarError(""); void removeAvatar().then(async () => { const profile = await me(); setAvatarVersion(profile.avatarVersion); setHasAvatar(profile.hasAvatar); }).catch(error => setAvatarError(error instanceof Error ? error.message : "Could not remove avatar.")).finally(() => setAvatarBusy(false)); }}>Remove</button>}</div>
        {avatarError && <p className="text-xs text-red-700 mt-2" role="alert">{avatarError}</p>}
        <Link to="/logout" className="flex items-center gap-2 text-sm text-slate-500 mt-4 no-underline"><LogOut size={16} />Sign out</Link>
      </div>
    </aside>
    <main className="md:ml-60 px-6 pt-24 pb-12 md:px-12 md:pt-12 max-w-7xl">
      <header className="flex flex-wrap items-center justify-between gap-5 mb-9"><div><h1 className="text-3xl font-semibold tracking-tight m-0">{title}</h1><p className="text-slate-500 text-sm mt-3">Your space to think together.</p></div><button className="button primary" onClick={() => setDialog({ type: "create" })}><Plus size={18} />New canvas</button></header>
      <div className="flex flex-wrap justify-between gap-4 mb-7"><label className="relative flex-1 max-w-md"><span className="sr-only">Search canvases or tags</span><Search size={18} className="absolute top-3 left-3 text-slate-400" /><input className="field w-full pl-10" type="search" placeholder="Search canvases or tags…" value={search} maxLength={120} onChange={e => setSearch(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm text-slate-500">Sort by<select className="field" value={sort} onChange={e => change("sort", e.target.value)}><option value="recent">Recently opened</option><option value="name">Name</option></select></label></div>
      {notice && <p role="status" className="text-sm text-slate-600">{notice}</p>}
      {error && <div role="alert" className="error">{error} <button className="button" onClick={() => setRefresh(n => n + 1)}>Retry</button><button className="button ml-2" onClick={signIn}>Sign in again</button></div>}
      {loading && !cursor ? <div role="status" className="grid lg:grid-cols-2 gap-5">{[1, 2, 3, 4].map(n => <div key={n} className="h-36 rounded-xl bg-slate-200 animate-pulse" />)}<span className="sr-only">Loading canvases</span></div> : !page.items.length && !error ?
        <div className="text-center py-20 border border-dashed border-slate-300 rounded-xl bg-white"><PanelsTopLeft size={36} className="mx-auto text-slate-400" /><h2 className="text-lg font-semibold mt-5">{query ? "No matching canvases" : filter === "shared" ? "Nothing shared with you yet" : filter === "templates" ? "No templates available" : "Make room for your next idea"}</h2><p className="text-slate-500 text-sm mb-5">{query ? "Try a different name or clear your search." : filter === "shared" ? "Accept an invitation link to see a canvas here." : filter === "templates" ? "Public templates and your private templates will appear here. Mark one of your canvases as a template from its actions menu." : "Create your first canvas and invite your team."}</p>{query ? <button className="button" onClick={() => { setSearch(""); change("q", ""); }}>Clear search</button> : filter !== "shared" && filter !== "templates" && <button className="button primary" onClick={() => setDialog({ type: "create" })}>New canvas</button>}</div> :
        <div className="grid lg:grid-cols-2 gap-5">{page.items.map(canvas => <article key={canvas.id} className="group relative rounded-xl border border-slate-200 bg-white p-6 hover:border-blue-300 transition-colors">
          <div className="flex justify-between gap-3"><span className="flex items-center justify-center rounded-lg w-10 h-10 bg-blue-50 text-blue-600"><PanelsTopLeft size={21} /></span>
            {canvas.relationship === "owner" && <details className="relative"><summary className="icon-button list-none cursor-pointer" aria-label={`Actions for ${canvas.name}`}><MoreHorizontal size={20} /></summary><div className="absolute right-0 top-9 z-10 bg-white border border-slate-200 rounded-lg shadow-lg p-1 min-w-32"><button className="menu-item" onClick={e => { e.currentTarget.closest("details")!.open = false; setDialog({ type: "rename", canvas }); }}>Rename</button><button className="menu-item" onClick={e => { e.currentTarget.closest("details")!.open = false; setDialog({ type: "share", canvas }); }}>Share</button><button className="menu-item" onClick={e => { e.currentTarget.closest("details")!.open = false; setDialog({ type: "tags", canvas }); }}>Manage tags</button><button className="menu-item" onClick={e => { e.currentTarget.closest("details")!.open = false; setDialog({ type: "template", canvas }); }}>{canvas.templateVisibility ? "Template settings" : "Make template"}</button><button className="menu-item text-red-700" onClick={e => { e.currentTarget.closest("details")!.open = false; setDialog({ type: "delete", canvas }); }}>Delete</button></div></details>}</div>
          {filter === "templates" ? <h2 className="mt-4 font-semibold text-slate-900 truncate">{canvas.name}</h2> : <Link to={`/b/${canvas.id}`} state={{ dashboard: `/?${params}` }} className="mt-4 flex items-center justify-between font-semibold text-slate-900 no-underline hover:text-blue-700"><span className="truncate">{canvas.name}</span><ArrowUpRight size={18} className="text-slate-400 shrink-0" /></Link>}
          <p className="text-sm text-slate-500 mt-2 mb-5 truncate">{filter === "templates" ? `${canvas.templateVisibility === "public" ? "Public" : "Private"} template by ${canvas.owner.displayName}` : canvas.relationship === "owner" ? (canvas.templateVisibility ? `${canvas.templateVisibility === "public" ? "Public" : "Private"} template · Owned by you` : "Owned by you") : `Shared by ${canvas.owner.displayName}`}</p>
          <p className="text-xs text-slate-400 m-0">{canvas.lastOpenedAt ? `Last opened ${new Date(canvas.lastOpenedAt).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}` : "Not opened yet"}</p>
          {canvas.tags.length > 0 && <div aria-label="Canvas tags" className="flex flex-wrap gap-1 mt-3">{canvas.tags.map(tag => <span key={tag} className="tag-chip">{tag}</span>)}</div>}
          {filter === "templates" && <div className="flex flex-wrap gap-2 mt-4">{canvas.relationship === "owner" && <button className="button" onClick={() => navigate(`/b/${canvas.id}`, { state: { dashboard: `/?filter=templates` } })}><Pencil size={16} />Edit template</button>}<button className="button primary" onClick={() => setDialog({ type: "start-template", canvas })}>Start template</button></div>}
        </article>)}</div>}
      {page.nextCursor && !error && <div className="text-center mt-8"><button className="button" disabled={loading} onClick={() => setCursor(page.nextCursor)}>{loading ? "Loading…" : "Load more"}</button></div>}
    </main>
    {dialog?.type === "create" && <NameDialog title="Create canvas" initial="Untitled canvas" close={() => setDialog(null)} action={async name => { const canvas = await createBoard(name); navigate(`/b/${canvas.id}`, { state: { dashboard: `/?${params}` } }); }} />}
    {dialog?.type === "start-template" && <NameDialog title="Name your canvas" submitLabel="Start canvas" initial={`Untitled canvas (based on template ${dialog.canvas!.name})`} close={() => setDialog(null)} action={async name => { const copy = await startTemplate(dialog.canvas!.id, name); navigate(`/b/${copy.id}`, { state: { dashboard: `/?filter=templates` } }); }} />}
    {dialog?.type === "rename" && <NameDialog title="Rename canvas" initial={dialog.canvas!.name} close={() => setDialog(null)} action={async name => { await renameBoard(dialog.canvas!.id, name); setDialog(null); setCursor(null); setRefresh(n => n + 1); }} />}
    {dialog?.type === "share" && <ShareDialog id={dialog.canvas!.id} name={dialog.canvas!.name} close={() => setDialog(null)} />}
    {dialog?.type === "tags" && <TagDialog name={dialog.canvas!.name} initial={dialog.canvas!.tags} close={() => setDialog(null)} save={async tags => { await setCanvasTags(dialog.canvas!.id, tags); setDialog(null); setCursor(null); setRefresh(n => n + 1); }} />}
    {dialog?.type === "delete" && <DeleteCanvasDialog name={dialog.canvas!.name} close={() => setDialog(null)} action={async () => {
      const id = dialog.canvas!.id;
      await deleteBoard(id);
      setDialog(null); setNotice("Canvas deleted.");
      setPage(previous => ({ ...previous, items: previous.items.filter(canvas => canvas.id !== id) }));
      setCursor(null); setRefresh(n => n + 1);
    }} />}
    {dialog?.type === "template" && <TemplateDialog name={dialog.canvas!.name} visibility={dialog.canvas!.templateVisibility ?? null} close={() => setDialog(null)} save={async (visibility: TemplateVisibility) => {
      const canvas = dialog.canvas!;
      await setTemplateVisibility(canvas.id, visibility);
      setDialog(null);
      setPage(previous => ({ ...previous, items: previous.items.map(item => item.id === canvas.id ? { ...item, templateVisibility: visibility } : item) }));
      setRefresh(n => n + 1);
    }} remove={dialog.canvas!.templateVisibility ? async () => {
      const canvas = dialog.canvas!;
      await removeTemplate(canvas.id);
      setDialog(null);
      setPage(previous => ({ ...previous, items: previous.items.map(item => item.id === canvas.id ? { ...item, templateVisibility: null } : item) }));
      setRefresh(n => n + 1);
    } : null} />}
  </div>;
}
