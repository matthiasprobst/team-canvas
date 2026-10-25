import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { LogOut, UsersRound } from "lucide-react";
import type { Account } from "./api";

export default function AccountMenu({ user }: { user: Account }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const location = useLocation();

  useEffect(() => setOpen(false), [location.key]);
  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  return (
    <div
      className="account-menu"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="account-trigger"
        aria-label={`Account: ${user.displayName}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">{Array.from(user.displayName.trim())[0]?.toUpperCase() || "?"}</span>
      </button>
      {open && (
        <nav id={panelId} className="account-dropdown" aria-label="Account">
          <p className="account-name">{user.displayName}</p>
          <p className="account-reference" title={user.id}>{user.username ? `@${user.username} · ` : ""}Account {user.id.slice(0, 8)}</p>
          {user.admin && (
            <Link className="account-link" to="/admin" onClick={() => setOpen(false)}>
              <UsersRound size={16} aria-hidden="true" />
              User administration
            </Link>
          )}
          <Link className="account-link" to="/logout" onClick={() => setOpen(false)}>
            <LogOut size={16} aria-hidden="true" />
            Sign out
          </Link>
        </nav>
      )}
    </div>
  );
}
