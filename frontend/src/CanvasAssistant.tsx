import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Square, X, Sparkles, ArrowUpRight } from "lucide-react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { SessionView } from "./syncSession";
import type { BoardState } from "./protocol";
import { assistantRequest, type AssistantCanvas, type AssistantProposal, type AssistantReply } from "./assistant";
import { compileAssistantProposal, showAssistantObjects } from "./assistantEditor";

interface Message { role: "user" | "assistant"; content: string; referenceIds?: string[]; revision?: number; proposalId?: string; }
interface Props {
  board: BoardState;
  view: SessionView;
  editorRef: { current: ExcalidrawImperativeAPI | null };
  applyAssistant: (id: string, elements: readonly ExcalidrawElement[]) => void;
}

function ProposalCard({ proposal, ready, applyingId, apply, dismiss, objects }: {
  objects?: AssistantCanvas["objects"];
  proposal: AssistantProposal; ready: boolean; applyingId: string | null;
  apply: (proposal: AssistantProposal) => void; dismiss: (proposal: AssistantProposal) => Promise<void>;
}) {
  return <article className="assistant-proposal" data-proposal-id={proposal.id} aria-label="Canvas proposal">
    <strong>{proposal.status === "applied" ? "Added to canvas" : "Suggested canvas changes"}</strong>
    <p>{proposal.message}</p>
    <ul>{proposal.actions.map((action, index) => <li key={index}><span className="assistant-swatch" style={{ backgroundColor: action.color }} />{action.type === "move_object" ? `Move ${action.text || objects?.find(object => object.id === action.id)?.text.slice(0, 80) || action.id} to (${Math.round(action.x)}, ${Math.round(action.y)})` : action.type === "label_connection" ? `Connection label: ${action.text}` : `${action.type === "create_shape" ? `create ${action.shape}` : action.type.replaceAll("_", " ")}: ${action.text || action.shape}`}</li>)}</ul>
    {proposal.status === "pending" && <div className="assistant-proposal-actions">
      <button className="button primary" disabled={!ready || !!applyingId} onClick={() => apply(proposal)}>{applyingId === proposal.id ? "Saving…" : "Add to canvas"}</button>
      <button className="button" disabled={!!applyingId} onClick={() => { void dismiss(proposal); }}>Dismiss</button>
    </div>}
  </article>;
}

export default function CanvasAssistant({ board, view, editorRef, applyAssistant }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [summary, setSummary] = useState("");
  const [proposals, setProposals] = useState<AssistantProposal[]>([]);
  const [canvas, setCanvas] = useState<AssistantCanvas | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [context, setContext] = useState<"page" | "selection">("page");
  const requestRef = useRef<AbortController | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const ready = view.online && !view.busy;

  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => { if (open) textarea.current?.focus(); }, [open]);
  useEffect(() => { if (open) end.current?.scrollIntoView({ block: "nearest" }); }, [open, messages, loading, applyingId]);
  useEffect(() => {
    if (!open || !view.online) return;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const [status, pending] = await Promise.all([
          assistantRequest<{ configured: boolean; canvas: AssistantCanvas }>(board, `?pageId=${board.pageId}`, controller.signal),
          assistantRequest<AssistantProposal[]>(board, `/proposals?pageId=${board.pageId}`, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setConfigured(status.configured);
        setCanvas(status.canvas);
        setProposals(pending);
      } catch (problem) {
        if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : "Could not load the assistant.");
      }
    };
    const initial = setTimeout(() => { void refresh(); }, 200);
    const timer = setInterval(() => { void refresh(); }, 5000);
    return () => { controller.abort(); clearTimeout(initial); clearInterval(timer); };
  }, [open, view.online, board.id, board.pageId, board.epoch, board.roundId, board.revision]); // Context changes remount this component.

  useEffect(() => {
    if (applyingId && view.lastAcknowledgedCommandId === applyingId) {
      setProposals(previous => previous.map(proposal => proposal.id === applyingId ? { ...proposal, status: "applied" } : proposal));
      setApplyingId(null);
    } else if (applyingId && !view.unsaved && view.error) {
      setError(view.error);
      setApplyingId(null);
    }
  }, [applyingId, view.lastAcknowledgedCommandId, view.unsaved, view.error]);

  async function send() {
    const text = input.trim();
    if (text === "/new") {
      requestRef.current?.abort(); requestRef.current = null;
      setMessages([]); setSummary(""); setInput(""); setError(""); setLoading(false);
      return;
    }
    if (text.startsWith("/") && text !== "/compact") { setError("Available commands: /new and /compact."); return; }
    if (text === "/compact" && !messages.length && !summary) { setError("There is no conversation to compact yet."); return; }
    if (!text || !ready || loading || configured !== true || view.unsaved) return;
    const selectedIds = context === "selection" && text !== "/compact" ? Object.keys(editorRef.current?.getAppState().selectedElementIds ?? {}) : [];
    if (text !== "/compact" && context === "selection" && !selectedIds.length) { setError("Select objects on the canvas first, or choose Current page."); return; }
    const controller = new AbortController();
    requestRef.current = controller;
    setError("");
    setInput("");
    setLoading(true);
    if (text !== "/compact") setMessages(previous => [...previous.slice(-23), { role: "user", content: text }]);
    try {
      const reply = await assistantRequest<AssistantReply>(board, "", controller.signal, {
        message: text, pageId: board.pageId, epoch: board.epoch, selectedIds,
        history: [...(summary ? [{ role: "assistant", content: summary }] : []), ...messages.filter(message => message.content !== summary).slice(-(text === "/compact" ? 24 : summary ? 11 : 12)).map(({ role, content }) => ({ role, content: content.slice(0, 8000) }))],
      });
      if (controller.signal.aborted) return;
      if (text === "/compact") {
        setSummary(reply.message); setMessages([{ role: "assistant", content: reply.message }]); return;
      }
      setMessages(previous => [...previous, { role: "assistant", content: reply.message, referenceIds: reply.referenceIds, revision: reply.canvas?.board.revision, proposalId: reply.proposal?.id }]);
      if (reply.canvas && reply.canvas.scope !== "selection") setCanvas(reply.canvas);
      if (reply.proposal) setProposals(previous => [reply.proposal!, ...previous.filter(proposal => proposal.id !== reply.proposal!.id)]);
    } catch (problem) {
      if (!controller.signal.aborted) { setError(problem instanceof Error ? problem.message : "The assistant request failed."); setInput(text); }
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; setLoading(false); }
    }
  }

  function apply(proposal: AssistantProposal) {
    if (!editorRef.current || !ready || view.unsaved || applyingId) return;
    try {
      const result = compileAssistantProposal(editorRef.current, proposal, board);
      setError("");
      setApplyingId(proposal.id);
      applyAssistant(proposal.id, result.elements);
      showAssistantObjects(editorRef.current, result.createdIds);
    } catch (problem) { setApplyingId(null); setError(problem instanceof Error ? problem.message : "Could not apply the proposal."); }
  }

  async function dismiss(proposal: AssistantProposal) {
    try {
      await assistantRequest(board, `/proposals/${proposal.id}`, undefined, undefined, "DELETE");
      setProposals(previous => previous.filter(item => item.id !== proposal.id));
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Could not dismiss the proposal."); }
  }

  function close() { setOpen(false); launcher.current?.focus(); }

  return <div className="canvas-assistant shell">
    {open && <section id="canvas-assistant-panel" className="assistant-panel" aria-label="AI assistant" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
      <header className="assistant-heading">
        <div><Sparkles size={17} /><strong>Canvas assistant</strong></div>
        <button className="icon-button" aria-label="Close assistant" onClick={close}><X size={18} /></button>
      </header>
      <div className="assistant-scope">
        <label>Use <select aria-label="Assistant context" value={context} onChange={event => setContext(event.target.value as "page" | "selection")} disabled={loading}>
          <option value="page">Current page</option><option value="selection">Selected objects</option>
        </select></label>
        <span>{board.mode === "poker" ? "Shared + your private draft" : "Saved canvas content"}</span>
      </div>
      <div className="assistant-content">
        {proposals.filter(proposal => proposal.status !== "dismissed" && !messages.some(message => message.proposalId === proposal.id)).map(proposal =>
          <ProposalCard key={proposal.id} proposal={proposal} ready={ready && !view.unsaved} applyingId={applyingId} apply={apply} dismiss={dismiss} objects={canvas?.objects} />)}
        {messages.length === 0 && <div className="assistant-welcome">
          <span className="assistant-symbol"><Sparkles size={24} /></span>
          <h2>Think together. Draw together.</h2>
          <p>Ask about this page, create notes and shapes, or connect your ideas.</p>
          {["How many notes are on this page?", "What is written in the notes?", "Create three notes: Research, Design, Build", "Which notes should be connected?"].map(prompt =>
            <button className="assistant-suggestion" key={prompt} onClick={() => { setInput(prompt); textarea.current?.focus(); }}>{prompt}<ArrowUpRight size={14} /></button>)}
        </div>}
        <div role="log" aria-label="Assistant conversation" aria-live="polite" aria-relevant="additions">
          {messages.map((message, index) => <article className={`assistant-message is-${message.role}`} key={index}>
            <span className="assistant-speaker">{message.role === "user" ? "You" : "Assistant"}</span>
            <p>{message.content}</p>
            {message.referenceIds?.map(id => <button className="assistant-reference" key={id} onClick={() => { if (editorRef.current) showAssistantObjects(editorRef.current, [id]); }}>
              {canvas?.objects.find(object => object.id === id)?.text.slice(0, 45) || "Show object"}<ArrowUpRight size={12} />
            </button>)}
            {message.revision !== undefined && message.revision < board.revision && <small>Canvas changed since this answer.</small>}
            {proposals.filter(proposal => proposal.id === message.proposalId && proposal.status !== "dismissed").map(proposal =>
              <ProposalCard key={proposal.id} proposal={proposal} ready={ready && !view.unsaved} applyingId={applyingId} apply={apply} dismiss={dismiss} objects={canvas?.objects} />)}
          </article>)}
        </div>
        {loading && <p className="assistant-thinking" role="status">Thinking…</p>}
        <div ref={end} />
      </div>
      {canvas && <div className="assistant-facts" aria-label="Canvas counts">Page: {canvas.counts.notes} notes · {canvas.counts.shapes} shapes · {canvas.counts.texts} texts · {canvas.counts.connections} connections</div>}
      {configured === false && <p className="assistant-notice" role="status">AI chat is not configured. Your administrator can connect an AI service. External assistant proposals can still be reviewed here.</p>}
      {!view.online && <p className="assistant-notice" role="status">Offline. Reconnect to ask questions or apply changes.</p>}
      {view.unsaved && <p className="assistant-notice" role="status">Waiting for your canvas changes to save…</p>}
      {error && <p className="assistant-error" role="alert">{error}</p>}
      <form className="assistant-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
        <label className="assistant-input-label" htmlFor="assistant-message">Ask about your canvas</label>
        <textarea id="assistant-message" ref={textarea} value={input} maxLength={4000} rows={2} placeholder="Ask a question or describe what to create…"
          onChange={event => setInput(event.target.value)} onKeyDown={event => {
            event.stopPropagation();
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
          }} />
        <div className="assistant-composer-actions"><span>/new · /compact · Review changes before adding.</span>
          {loading ? <button className="button" type="button" onClick={() => { requestRef.current?.abort(); setLoading(false); }}><Square size={13} />Stop</button>
            : <button className="button primary" type="submit" aria-label="Send message" disabled={!input.trim() || (input.trim() !== "/new" && (!ready || view.unsaved || configured !== true))}><Send size={15} />Send</button>}
        </div>
      </form>
    </section>}
    <button ref={launcher} className="assistant-launcher" aria-label={open ? "Minimize AI assistant" : "Open AI assistant"} aria-expanded={open} aria-controls="canvas-assistant-panel" onClick={() => { if (open) close(); else setOpen(true); }}>
      <MessageCircle size={20} /><span>AI assistant</span>
    </button>
  </div>;
}
