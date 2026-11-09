// Offline self-test: drives the real projection fold from the Host half and
// renders the real browser half through a minimal React stand-in. No DSH
// process, no browser, no session file. Read-only.
//
// Usage: node selftest.mjs
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'

const hostModule = await import('./index.js')
const { apply: hostApply, turnTimerUnit, name: pluginName } = hostModule

let failures = 0
function check(label, condition, detail) {
  if (condition) { console.log('  PASS', label); return }
  failures++
  console.log('  FAIL', label, detail === undefined ? '' : `-> ${detail}`)
}

/* ── fold ─────────────────────────────────────────────────────────────── */

const T0 = Date.UTC(2026, 10, 5, 1, 50, 0) // 09:50 local
const at = (seconds) => T0 + seconds * 1000
const ev = (type, seconds, data = {}) => ({ type, seq: 0, time: at(seconds), data })

console.log('projection fold:')
check('unit declares the documented contract',
  turnTimerUnit.key === 'turnTimer' && Number.isSafeInteger(turnTimerUnit.stateVersion) && typeof turnTimerUnit.stateSchema?.parse === 'function' && turnTimerUnit.apply && turnTimerUnit.wire?.view && pluginName === 'turn-timer')
check('the unit is client-visible (wire view + schema)', typeof turnTimerUnit.wire?.viewSchema?.parse === 'function')
check('the state schema also answers safeParse', turnTimerUnit.stateSchema.safeParse({ turn: 1, lastMs: 5, at: 6, startedAt: null }).success === true
  && turnTimerUnit.stateSchema.safeParse({ turn: -1, lastMs: null, at: null, startedAt: null }).success === false)
check('the state schema carries the open turn start time', turnTimerUnit.stateSchema.parse({ turn: 1, lastMs: null, at: null, startedAt: 7 }).startedAt === 7
  && turnTimerUnit.stateSchema.safeParse({ turn: 1, lastMs: null, at: null, startedAt: -1 }).success === false)
/* stateVersion 2 dropped the module-scoped start time; a version-1 row has no
 * `startedAt`, so it must be rejected here and refolded instead of restored. */
check('a version-1 checkpoint row is refused', turnTimerUnit.stateSchema.safeParse({ turn: 1, lastMs: 5, at: 6 }).success === false)
check('the reading stays out of the Session summary block', turnTimerUnit.wire.summary === false)

/* A regression guard for the failure that broke boot once already: no
 * top-level `inject` on the host half. Declaring it there makes a missing
 * registry fail (or stall) the plugin itself, and the desktop boot policy
 * turns one failed entry into a failed application. */
check('the host half declares no top-level inject', hostModule.inject === undefined)
check('the host half cannot throw when the registry is absent', (() => {
  try {
    hostApply({ inject: () => { throw new Error('no sessionProjections') } })
    return true
  } catch { return false }
})())
check('the host half waits for the registry as a child plugin', (() => {
  let asked = null
  let registered = false
  hostApply({
    inject: (deps, body) => { asked = deps; body({ effect: (fn) => fn(), sessionProjections: { register: () => { registered = true } } }) },
  })
  return Array.isArray(asked) && asked.includes('sessionProjections') && registered
})())

const start = turnTimerUnit.init()
check('initial view is empty', JSON.stringify(turnTimerUnit.wire.view(start)) === '{"turn":0,"lastMs":null,"at":null}')

/* One round: prompt at 0, turn/start at 1 (after a second of latency), close at 41. */
let s = start
const prompt = (seconds) => ev('user/message', seconds, { source: { kind: 'user' } })
for (const e of [prompt(0), ev('turn/start', 1, { turn: 1 }), ev('step/start', 1, { turn: 1, step: 1 }), ev('step/end', 40, { turn: 1, step: 1 }), ev('turn/end', 41, { turn: 1 })]) {
  s = turnTimerUnit.apply(s, e)
}
let view = turnTimerUnit.wire.view(s)
check('a completed round reports its elapsed time (40s)', view.lastMs === 40_000, String(view.lastMs))
check('the reading lands on the closing event', view.at === at(41))
check('the state and the view both validate', turnTimerUnit.stateSchema.parse(s) && turnTimerUnit.wire.viewSchema.parse(view))

/* Idle time between rounds is excluded: next prompt at 300s, started at 301s. */
s = turnTimerUnit.apply(s, ev('user/message', 299, { source: { kind: 'runtime-context' } }))
check('runtime context does not clear the reading', turnTimerUnit.wire.view(s).lastMs === 40_000)
s = turnTimerUnit.apply(s, prompt(300))
check('a new prompt clears the previous reading', turnTimerUnit.wire.view(s).lastMs === null)
s = turnTimerUnit.apply(s, ev('turn/start', 301, { turn: 2 }))
s = turnTimerUnit.apply(s, ev('turn/end', 305, { turn: 2 }))
view = turnTimerUnit.wire.view(s)
check('the next round measures from turn/start, not the prompt (4s)', view.lastMs === 4_000, String(view.lastMs))
check('turn number follows the log', view.turn === 2, String(view.turn))

/* A log that begins mid-turn has no turn/start. */
let mid = turnTimerUnit.apply(turnTimerUnit.init(), ev('step/start', 10, { turn: 7, step: 1 }))
mid = turnTimerUnit.apply(mid, ev('turn/end', 13, { turn: 7 }))
check('a log opening mid-turn still times that turn (3s)', turnTimerUnit.wire.view(mid).lastMs === 3_000, String(turnTimerUnit.wire.view(mid).lastMs))

/* A repaired log can close a turn it never started. */
let repaired = turnTimerUnit.apply(turnTimerUnit.init(), ev('turn/end', 5, { turn: 3 }))
check('an orphan turn/end is ignored', turnTimerUnit.wire.view(repaired).lastMs === null)

/* A second closer for the same turn must not overwrite the first reading. */
const once = turnTimerUnit.apply(s, ev('turn/end', 999, { turn: 3 }))
check('a duplicate turn/end keeps the last reading', turnTimerUnit.wire.view(once).lastMs === 4_000, String(turnTimerUnit.wire.view(once).lastMs))

/* A turn that starts before its end was logged never goes negative. */
let skew = turnTimerUnit.apply(turnTimerUnit.init(), ev('turn/start', 20, { turn: 4 }))
skew = turnTimerUnit.apply(skew, ev('turn/end', 20, { turn: 4 }))
check('zero elapsed stays a reading, not a blank pill', turnTimerUnit.wire.view(skew).lastMs === 0)

/* The registry holds one unit object for every Session (including subagent
 * turns), so two open turns interleave through the same `apply`. The start
 * time therefore lives in the per-Session state; a module-level one made the
 * parent's closer read the child's clock (and produced no reading at all). */
let parent = turnTimerUnit.apply(turnTimerUnit.init(), ev('turn/start', 1, { turn: 1 }))
let child = turnTimerUnit.apply(turnTimerUnit.init(), ev('turn/start', 10, { turn: 1 }))
child = turnTimerUnit.apply(child, ev('turn/end', 20, { turn: 1 }))
parent = turnTimerUnit.apply(parent, ev('turn/end', 50, { turn: 1 }))
check('a turn interleaved with another Session keeps both readings',
  turnTimerUnit.wire.view(child).lastMs === 10_000 && turnTimerUnit.wire.view(parent).lastMs === 49_000,
  JSON.stringify([turnTimerUnit.wire.view(child).lastMs, turnTimerUnit.wire.view(parent).lastMs]))

/* ── browser half ─────────────────────────────────────────────────────── */

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')

/* The bundle is evaluated the way the shell loads it: through
 * `window.__ModuleLoader__.load`, with `react` the only import. The real
 * loader then calls the exported `apply` with the client context. */
/* Component elements are rendered eagerly, then children are flattened, which
 * is what React does between the dock entry's wrapper and its real component. */
const react = {
  createElement: (type, own, ...children) => {
    const props = own ?? {}
    const flat = children.flat(Infinity).map((child) => (typeof child === 'function' ? child(props) : child))
    return { type, props, children: flat.flat(Infinity) }
  },
}

const registrations = []
const localeDictionaries = []
const ctx = {
  effect: (fn) => fn(),
  locale: {
    register: (ns, dictionaries) => { localeDictionaries.push([ns, dictionaries]) },
    /** Resolve `{name}` placeholders the way the client locale does. */
    bind: (ns) => {
      const table = localeDictionaries.find(([key]) => key === ns)[1].zh
      return (key, vars) => table[key].replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? `{${name}}`))
    },
  },
  slots: {
    /* The engine drains the callback as a generator, exactly like the dock's
     * own entries; a plain function that registers directly is drained too. */
    inject: (_name, fn) => {
      const outcome = fn()
      if (outcome !== null && typeof outcome === 'object' && typeof outcome.next === 'function') {
        let step = outcome.next()
        while (!step.done) step = outcome.next()
      }
    },
    register: (meta, component) => { registrations.push({ meta, component }); return () => {} },
  },
}

let loaded
const window = {
  __ModuleLoader__: {
    load: ({ factory }) => { loaded = factory((specifier) => { if (specifier === 'react') return react; throw new Error(`unexpected require(${specifier})`) }) },
  },
}
runInContext(source, createContext({ window, console }))
check('the bundle loads through the module loader', loaded !== undefined && typeof loaded.apply === 'function')

/* Cordis gates service reads on declared dependencies. Reproduce that gate with
 * a strict context so a missing `inject` entry fails here instead of in the
 * desktop renderer, where one failed entry aborts the whole web boot. */
const declared = loaded.inject
check('the browser half declares its service dependencies', Array.isArray(declared) && declared.includes('slots') && declared.includes('locale'), JSON.stringify(declared))
const strictCtx = new Proxy(ctx, {
  get(target, prop, receiver) {
    if ((prop === 'slots' || prop === 'locale') && !(Array.isArray(declared) && declared.includes(prop))) {
      throw new Error(`cannot get property "${String(prop)}" without inject`)
    }
    return Reflect.get(target, prop, receiver)
  },
})
check('registration needs no undeclared service', (() => {
  try { loaded.apply(strictCtx); return true } catch (error) { return error.message }
})() === true, 'strict inject gate rejected the registration')

/* The probe above registered through the same context object; reset so the
 * assertions below describe exactly one real activation. */
registrations.length = 0
localeDictionaries.length = 0
loaded.apply(ctx)

check('the browser half registers the dock entry', registrations.length === 1, String(registrations.length))
const entry = registrations[0]
check('it targets the composer dock', entry.meta.name === 'conversation.composer.dock')
check('its id is turn-timer', entry.meta.id === 'turn-timer')
check('it declares both dictionaries', localeDictionaries.length === 1 && localeDictionaries[0][1].zh && localeDictionaries[0][1].en)

/* Render the component itself with a fake `useProjection`, which is the only
 * dock prop it reads. Elements come back as plain objects from the stand-in. */
const t = ctx.locale.bind(entry.meta.locale)
const { TurnTimer } = loaded.internals
const renderWith = (projection) => TurnTimer({ useProjection: (key) => (key === 'turnTimer' ? projection : undefined), t })

/** Every text node under an element, the way React would render it. */
function text(node) {
  if (node === null || node === undefined || node === false) return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(text)
  return text(node.children)
}

check('no projection yet renders nothing', renderWith(undefined) === null)
check('a running turn renders nothing', renderWith({ turn: 1, lastMs: null, at: null }) === null)

const pill = renderWith({ turn: 1, lastMs: 40_000, at: 0 })
check('a completed turn renders a pill tagged data-turn-timer', pill !== null && pill.props['data-turn-timer'] === true)
const shown = text(pill)
check('the pill reads 本轮耗时 40 秒', shown.join('').replace(/\s+/g, ' ') === '本轮耗时 40 秒', JSON.stringify(shown))
check('the pill carries a stopwatch glyph', typeof pill.children[0]?.type === 'function', String(pill.children[0]?.type))
check('the pill carries the turn number', pill.props['data-turn-timer-turn'] === 1)

const long = text(renderWith({ turn: 2, lastMs: 125_000, at: 0 })).join(' ')
check('over a minute it reads minutes and seconds', long.includes('2 分 5 秒'), long)
const sub = text(renderWith({ turn: 3, lastMs: 1_240, at: 0 })).join(' ')
check('under a minute it keeps one decimal', sub.includes('1.2 秒'), sub)

const style = pill.props.style
check('pill font matches the shipped stats pill', style.fontSize === 'calc(var(--dsh-content-font-size-secondary, 13px) - 1px)')
check('pill line-height matches the shipped stats pill', style.lineHeight === 'calc(20px + var(--dsh-content-font-delta-secondary, 0px))')

console.log(failures === 0 ? '\nSELFTEST PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
