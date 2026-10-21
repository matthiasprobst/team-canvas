import { lazy, Suspense, useEffect, useState } from "react";
import {
  createBrowserRouter,
  Link,
  Navigate,
  Outlet,
  RouterProvider,
  ScrollRestoration,
  useOutletContext,
  useParams,
} from "react-router-dom";
import {
  ApiError,
  me,
  signIn,
  previewInvitation,
  joinBoard,
  request,
  type Account,
  type Identity,
} from "./api";
import Dashboard from "./Dashboard";
import { preserveInvitation } from "./invitation";
import { errorMessage } from "./ui";
const Editor = lazy(() => import("./App"));
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <main className="shell min-h-screen grid place-items-center bg-slate-50 p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 p-8 rounded-xl">{children}</div>
    </main>
  );
}
function Login({ reset = false }: { reset?: boolean }) {
  return (
    <Notice>
      <h1 className="text-2xl font-semibold">Team Canvas</h1>
      <p className="text-slate-500 my-5">
        A shared space for your team’s ideas. Sign in to create canvases and collaborate.
      </p>
      <button className="button primary" onClick={signIn}>
        Login with SSO
      </button>
      {reset && (
        <a className="block mt-4 text-sm" href="/api/oidc/logout">
          Reset an expired sign-in session
        </a>
      )}
    </Notice>
  );
}
function Protected() {
  const [user, setUser] = useState<Account | null>(null);
  const [error, setError] = useState("");
  const [auth, setAuth] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    setAuth(false);
    void me(abort.signal)
      .then(setUser)
      .catch((e) => {
        if (abort.signal.aborted) return;
        setAuth(e instanceof ApiError && [401, 499].includes(e.status));
        setError(errorMessage(e));
      });
    return () => abort.abort();
  }, [retry]);
  if (!user && auth) return <Login reset />;
  if (error)
    return (
      <Notice>
        <p role="alert">{error}</p>
        <button className="button" onClick={() => setRetry((n) => n + 1)}>
          Retry
        </button>
      </Notice>
    );
  if (!user)
    return (
      <Notice>
        <p role="status">Loading your workspace…</p>
      </Notice>
    );
  return (
    <>
      <Outlet context={user} />
      <ScrollRestoration getKey={(location) => location.pathname + location.search} />
    </>
  );
}
function Home() {
  return <Dashboard user={useOutletContext<Account>()} />;
}
function CanvasRoute() {
  const { id = "" } = useParams();
  return <Join key={id} id={id} />;
}
function Join({ id }: { id: string }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [invite] = useState(() => sessionStorage.getItem(`invitation:${id}`));
  const [preview, setPreview] = useState<{ name: string; ownerName: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    setError("");
    if (!/^[a-f0-9-]{36}$/i.test(id)) {
      setError("Canvas not found.");
      return;
    }
    if (invite)
      void previewInvitation(id, invite, abort.signal)
        .then((value) => {
          if (active) setPreview(value);
        })
        .catch((e) => {
          if (active) {
            setError(errorMessage(e));
            if (e instanceof ApiError && [400, 404].includes(e.status))
              sessionStorage.removeItem(`invitation:${id}`);
          }
        });
    else
      void joinBoard(id)
        .then((value) => {
          if (active) setIdentity(value);
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        });
    return () => {
      active = false;
      abort.abort();
    };
  }, [id, invite, retry]);
  if (identity)
    return (
      <Suspense
        fallback={
          <Notice>
            <p role="status">Opening canvas…</p>
          </Notice>
        }
      >
        <Editor boardId={id} identity={identity} />
      </Suspense>
    );
  return (
    <Notice>
      {preview ? (
        <>
          <p className="text-sm text-slate-500">You’re invited</p>
          <h1 className="text-2xl font-semibold">{preview.name}</h1>
          <p className="text-slate-500 my-5">
            Shared by {preview.ownerName}. Accept to add this canvas to your dashboard.
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void joinBoard(id, invite!)
                .then((value) => {
                  sessionStorage.removeItem(`invitation:${id}`);
                  setIdentity(value);
                })
                .catch((e) => setError(errorMessage(e)))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Joining…" : "Accept invitation"}
          </button>
        </>
      ) : (
        !error && <p role="status">Opening canvas…</p>
      )}
      {error && (
        <>
          <p role="alert" className="error">
            {error}
          </p>
          <button className="button" onClick={() => setRetry((n) => n + 1)}>
            Retry
          </button>
          <button className="button ml-2" onClick={signIn}>
            Sign in again
          </button>
        </>
      )}
      <Link
        className="block mt-5 text-sm text-slate-500"
        to="/"
        onClick={() => sessionStorage.removeItem(`invitation:${id}`)}
      >
        Back to canvases
      </Link>
    </Notice>
  );
}
function Logout() {
  const [error, setError] = useState("");
  useEffect(() => {
    void request<{ redirect: string }>("/api/logout", {})
      .then((result) => {
        sessionStorage.clear();
        location.replace(result.redirect);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);
  return (
    <Notice>
      <p role={error ? "alert" : "status"}>{error || "Signing out…"}</p>
      {error && (
        <>
          <a href="/api/oidc/logout">Finish signing out</a>
          <Link to="/">Back to canvases</Link>
        </>
      )}
    </Notice>
  );
}
// Route initialization runs once before Protected can initiate authentication.
preserveInvitation();
const router = createBrowserRouter([
  { path: "/login", element: <Navigate to="/" replace /> },
  {
    element: <Protected />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/b/:id", element: <CanvasRoute /> },
      { path: "/logout", element: <Logout /> },
    ],
  },
  {
    path: "*",
    element: (
      <Notice>
        <h1>Page not found</h1>
        <Link to="/">Back to canvases</Link>
      </Notice>
    ),
  },
]);
export default function AppRouter() {
  return <RouterProvider router={router} />;
}
