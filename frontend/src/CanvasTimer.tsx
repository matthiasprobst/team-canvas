import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Timer } from "lucide-react";
import type { CanvasTimerState, TimerAction } from "./protocol";

function formatRemaining(milliseconds: number) {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function CanvasTimer({
  timer,
  disabled,
  onAction,
  onSetDuration,
}: {
  timer: CanvasTimerState;
  disabled: boolean;
  onAction: (action: TimerAction) => void;
  onSetDuration: (minutes: number, seconds: number) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState<{ value: string; original: string } | null>(null);
  const cancelEdit = useRef(false);

  useEffect(() => {
    if (!timer.running) return;
    setDraft(null);
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [timer.running]);

  const remaining = timer.running && timer.startedAtEpochMs !== null
    ? Math.max(0, timer.remainingMs - Math.max(0, now - timer.startedAtEpochMs))
    : timer.remainingMs;
  const displayTime = formatRemaining(remaining);
  const canReset = !disabled && (timer.running || timer.remainingMs !== timer.durationMs);
  const startLabel = remaining > 0 && remaining < timer.durationMs ? "Resume countdown" : "Start countdown";

  return (
    <div className="canvas-timer" role="group" aria-label="Shared canvas countdown timer">
      <span className="timer-readout">
        <Timer size={15} aria-hidden="true" />
        <input
          aria-label="Countdown time in minutes and seconds"
          title={timer.running ? "Pause to edit the countdown" : "Edit minutes:seconds; press Enter to apply"}
          placeholder="MM:SS"
          type="text"
          maxLength={6}
          value={timer.running ? displayTime : draft?.value ?? displayTime}
          disabled={disabled}
          readOnly={timer.running}
          onFocus={(event) => {
            if (timer.running) return;
            cancelEdit.current = false;
            setDraft({ value: displayTime, original: displayTime });
            event.currentTarget.select();
          }}
          onChange={(event) => {
            const value = event.target.value;
            if (/^[\d:]*$/.test(value))
              setDraft((current) => ({ value, original: current?.original ?? displayTime }));
          }}
          onBlur={() => {
            if (!cancelEdit.current && !disabled && !timer.running && draft && draft.value !== draft.original) {
              const match = /^(\d{1,3}):(\d{1,2})$/.exec(draft.value);
              if (match) {
                const minutes = Number(match[1]);
                const seconds = Number(match[2]);
                if (seconds < 60 && (minutes > 0 || seconds > 0)) onSetDuration(minutes, seconds);
              }
            }
            cancelEdit.current = false;
            setDraft(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") {
              event.preventDefault();
              cancelEdit.current = event.key === "Escape";
              event.currentTarget.blur();
            }
          }}
        />
      </span>
      <button
        className="nav-button timer-button"
        aria-label={timer.running ? "Pause countdown" : startLabel}
        title={timer.running ? "Pause countdown" : startLabel}
        disabled={disabled || (!timer.running && timer.durationMs === 0)}
        onClick={() => onAction(timer.running ? "pause" : "start")}
      >
        {timer.running ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <button
        className="nav-button timer-button"
        aria-label="Reset countdown"
        title="Reset countdown"
        disabled={!canReset}
        onClick={() => onAction("reset")}
      >
        <RotateCcw size={15} />
      </button>
    </div>
  );
}
