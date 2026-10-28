package dev.teamcanvas

import jakarta.enterprise.context.ApplicationScoped
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** Countdown timers are temporary shared session state, independent of saved scene data. */
@ApplicationScoped
class CanvasTimerService {
    private data class Timer(
        var durationMs: Long = DEFAULT_DURATION_MS,
        var remainingMs: Long = DEFAULT_DURATION_MS,
        var startedAtNanos: Long? = null,
        var startedAtEpochMs: Long? = null,
    )

    private val timers = ConcurrentHashMap<UUID, Timer>()

    @Synchronized
    fun state(boardId: UUID): CanvasTimerState {
        val timer = timers[boardId] ?: return CanvasTimerState()
        return timer.toState()
    }

    @Synchronized
    fun start(boardId: UUID): CanvasTimerState {
        val timer = timers.getOrPut(boardId) { Timer() }
        settle(timer)
        if (timer.startedAtNanos == null) {
            if (timer.remainingMs == 0L) timer.remainingMs = timer.durationMs
            timer.startedAtNanos = System.nanoTime()
            timer.startedAtEpochMs = System.currentTimeMillis()
        }
        return timer.toState()
    }

    @Synchronized
    fun pause(boardId: UUID): CanvasTimerState {
        val timer = timers[boardId] ?: return CanvasTimerState()
        settle(timer)
        if (timer.startedAtNanos != null) {
            timer.remainingMs = remaining(timer)
            timer.startedAtNanos = null
            timer.startedAtEpochMs = null
        }
        return timer.toState()
    }

    @Synchronized
    fun reset(boardId: UUID): CanvasTimerState {
        val timer = timers.getOrPut(boardId) { Timer() }
        timer.remainingMs = timer.durationMs
        timer.startedAtNanos = null
        timer.startedAtEpochMs = null
        return timer.toState()
    }

    @Synchronized
    fun setDuration(boardId: UUID, minutes: Int, seconds: Int): CanvasTimerState {
        if (minutes !in 0..999 || seconds !in 0..59 || (minutes == 0 && seconds == 0))
            throw ClientException("bad_request", "Set a timer duration from 00:01 to 999:59.")
        val timer = timers.getOrPut(boardId) { Timer() }
        settle(timer)
        if (timer.startedAtNanos != null)
            throw ClientException("invalid_state", "Pause the timer before changing its duration.")
        val duration = minutes * 60_000L + seconds * 1_000L
        timer.durationMs = duration
        timer.remainingMs = duration
        return timer.toState()
    }

    @Synchronized
    fun runningBoards(): List<UUID> = timers.filterValues { it.startedAtNanos != null }.keys.toList()

    @Synchronized
    fun expire(boardId: UUID): CanvasTimerState? {
        val timer = timers[boardId] ?: return null
        val wasRunning = timer.startedAtNanos != null
        settle(timer)
        return if (wasRunning && timer.startedAtNanos == null && timer.remainingMs == 0L) timer.toState() else null
    }

    @Synchronized
    fun remove(boardId: UUID) {
        timers.remove(boardId)
    }

    private fun settle(timer: Timer) {
        if (timer.startedAtNanos != null && remaining(timer) == 0L) {
            timer.remainingMs = 0
            timer.startedAtNanos = null
            timer.startedAtEpochMs = null
        }
    }

    private fun remaining(timer: Timer): Long =
        timer.startedAtNanos?.let { startedAt ->
            (timer.remainingMs - (System.nanoTime() - startedAt) / 1_000_000).coerceAtLeast(0)
        } ?: timer.remainingMs

    private fun Timer.toState(): CanvasTimerState {
        val remainingMs = remaining(this)
        val running = startedAtNanos != null && remainingMs > 0
        return CanvasTimerState(
            durationMs = durationMs,
            // Running clients subtract time since startedAtEpochMs from this baseline.
            remainingMs = if (running) this.remainingMs else remainingMs,
            running = running,
            startedAtEpochMs = startedAtEpochMs.takeIf { running },
        )
    }

    companion object {
        private const val DEFAULT_DURATION_MS = 300_000L
    }
}
