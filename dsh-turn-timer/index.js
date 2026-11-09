/**
 * Per-turn elapsed time, delivered as one session projection.
 *
 * The fold times one round of conversation from `turn/start` to `turn/end`;
 * the projection seam pushes the result to the browser, where the composer
 * dock reads `useProjection('turnTimer')`.
 *
 * Failure policy: this is an optional presentation feature. It must never be
 * able to hold up boot, so the projection registration is a child plugin that
 * waits for the registry instead of a top-level `inject` on this plugin, and
 * every registration error is contained here. A missing or broken registry
 * leaves the pill absent, not the application without a window.
 *
 * Concurrency policy: the registry keeps one cell per Session but calls
 * `init`/`apply` through the SAME unit object, so any timing state held in
 * module scope is shared by every Session and every subagent turn. The open
 * turn's start time therefore lives in the state (which the registry keeps per
 * Session), never in a module variable — see `stateVersion` 2.
 *
 * @module @local/dsh-turn-timer
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'turn-timer'

const isCount = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isTime = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0

/**
 * Validate one client view: the three fields the pill reads. The projection
 * seam parses every view it sends, so this carries zod's face: `parse` returns
 * or throws, `safeParse` reports instead of throwing.
 */
const viewSchema = {
  parse(value) {
    if (typeof value !== 'object' || value === null) throw new TypeError('turnTimer: expected an object')
    const { turn, lastMs, at } = value
    if (!isCount(turn)) throw new TypeError(`turnTimer.turn: expected a non-negative integer, got ${String(turn)}`)
    if (lastMs !== null && !isTime(lastMs)) {
      throw new TypeError(`turnTimer.lastMs: expected null or a non-negative number, got ${String(lastMs)}`)
    }
    if (at !== null && !isCount(at)) throw new TypeError(`turnTimer.at: expected null or an epoch, got ${String(at)}`)
    return { turn, lastMs, at }
  },
  safeParse(value) {
    try {
      return { success: true, data: this.parse(value) }
    } catch (error) {
      return { success: false, error }
    }
  },
}

/**
 * Validate one folded state. The state carries the open turn's start time,
 * which the client must not see; the seam persists and restores this value, so
 * the extra field is documented and checked here rather than left implicit.
 */
const stateSchema = {
  parse(value) {
    const view = viewSchema.parse(value)
    const { startedAt } = value
    if (startedAt !== null && !isTime(startedAt)) {
      throw new TypeError(`turnTimer.startedAt: expected null or an epoch, got ${String(startedAt)}`)
    }
    return { ...view, startedAt }
  },
  safeParse(value) {
    try {
      return { success: true, data: this.parse(value) }
    } catch (error) {
      return { success: false, error }
    }
  },
}

/** No turn has completed and none is open yet. */
const EMPTY = { turn: 0, lastMs: null, at: null, startedAt: null }

/**
 * The `turnTimer` projection unit. `stateVersion` 2 is the shape that carries
 * `startedAt`; version-1 checkpoint rows (which kept the start time in module
 * scope) are discarded and the log refolds from `init`.
 */
export const turnTimerUnit = {
  key: 'turnTimer',
  stateVersion: 2,
  stateSchema,
  init: () => EMPTY,
  apply: (state, event) => {
    switch (event.type) {
      case 'turn/start':
        /* `startedAt` replaces the former module-level `openAt`: one unit object
         * serves every Session, so only per-Session state survives concurrency. */
        return { turn: event.data.turn, lastMs: null, at: null, startedAt: event.time }
      case 'user/message':
        /* Only a human prompt opens a round: the same event also carries
         * `runtime-context` messages the loop appends on its own. */
        if (event.data?.source?.kind !== 'user') return state
        return { turn: state.turn, lastMs: null, at: null, startedAt: null }
      case 'step/start':
        /* A log that begins mid-turn has no turn/start to count from. */
        if (state.startedAt !== null) return state
        return { turn: event.data.turn, lastMs: null, at: null, startedAt: event.time }
      case 'turn/end':
        if (state.startedAt === null || state.lastMs !== null) return state
        /* Clamped: a repaired log can close a turn it never started. */
        return {
          turn: state.turn,
          lastMs: Math.max(0, event.time - state.startedAt),
          at: event.time,
          startedAt: null,
        }
      default:
        return state
    }
  },
  /* Without this the unit is host-only and `useProjection` never sees it.
   * `summary: false` keeps a session-local reading out of the Session-list
   * summary block, which would otherwise fold this unit for every row. */
  wire: {
    viewSchema,
    view: (state) => ({ turn: state.turn, lastMs: state.lastMs, at: state.at }),
    summary: false,
  },
}

/**
 * Register the `turnTimer` unit.
 *
 * Deliberately no top-level `inject`: the registry arrives as a child plugin,
 * so this plugin's own fiber activates immediately. One optional pill must not
 * be able to fail, or stall, the whole boot.
 *
 * @param ctx - plugin context.
 */
export function apply(ctx) {
  try {
    ctx.inject(['sessionProjections'], (child) => {
      child.effect(() => child.sessionProjections.register(turnTimerUnit), 'turn-timer: projection')
    })
  } catch (error) {
    /* Absent registry, or a host that rejects the child plugin: the pill simply
     * never appears. Never rethrow — boot must not depend on this feature. */
    console.warn('[turn-timer] projection unavailable:', error instanceof Error ? error.message : String(error))
  }
}
