import { useCallback, useEffect, useState } from "react";
import { request, type CanvasListPage } from "./api";
import { errorMessage } from "./errors";

interface CanvasFilters {
  filter?: string;
  sort?: string;
  query: string;
  debounceMs?: number;
  refreshOnFocus?: boolean;
}
const emptyPage = (): CanvasListPage => ({ items: [], nextCursor: null });

/** Pagination belongs to one filter set; aborted requests can never append to a newer list. */
export function useCanvasList({
  filter = "all",
  sort = "recent",
  query,
  debounceMs = 0,
  refreshOnFocus = false,
}: CanvasFilters) {
  const scope = new URLSearchParams({ filter, sort, q: query, limit: "24" }).toString();
  const [position, setPosition] = useState<{ scope: string; cursor: string | null }>({ scope, cursor: null });
  const cursor = position.scope === scope ? position.cursor : null;
  const [state, setState] = useState({ scope, page: emptyPage(), loading: true, error: "" });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => {
    setPosition({ scope: "", cursor: null });
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    setPosition((previous) => (previous.scope === scope ? previous : { scope, cursor: null }));
  }, [scope]);

  useEffect(() => {
    const abort = new AbortController();
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    const load = async () => {
      const params = new URLSearchParams(scope);
      if (cursor) params.set("cursor", cursor);
      try {
        const result = await request<CanvasListPage>(`/api/boards?${params}`, undefined, "GET", abort.signal);
        if (abort.signal.aborted) return;
        setState((previous) => {
          const earlier = cursor && previous.scope === scope ? previous.page.items : [];
          const seen = new Set(earlier.map((canvas) => canvas.id));
          const additions = result.items.filter((canvas) => {
            if (seen.has(canvas.id)) return false;
            seen.add(canvas.id);
            return true;
          });
          return {
            scope,
            loading: false,
            error: "",
            page: { items: [...earlier, ...additions], nextCursor: result.nextCursor },
          };
        });
      } catch (error) {
        if (!abort.signal.aborted) {
          setState((previous) => ({
            scope,
            page: previous.scope === scope ? previous.page : emptyPage(),
            loading: false,
            error: errorMessage(error),
          }));
        }
      }
    };
    const timer = setTimeout(() => {
      void load();
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [scope, cursor, revision, debounceMs]);

  useEffect(() => {
    if (!refreshOnFocus) return;
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refreshOnFocus, refresh]);

  const setPage = useCallback((update: (page: CanvasListPage) => CanvasListPage) => {
    setState((previous) => ({ ...previous, page: update(previous.page) }));
  }, []);
  const page = state.scope === scope ? state.page : emptyPage();
  return {
    page,
    cursor,
    setPage,
    refresh,
    loading: state.loading || state.scope !== scope,
    error: state.scope === scope ? state.error : "",
    loadMore: () => setPosition({ scope, cursor: page.nextCursor }),
  };
}
