// Replay real session logs through the plugin's fold, read-only.
//
//   node realdata.mjs [session.v4.jsonl.zstd ...]
//
// Without arguments it picks the three most recently written workspace
// sessions. Every log is decompressed, every event is folded exactly as the
// host half would see it, and the final reading is compared with the wall
// time of the last turn computed straight from its turn/start and turn/end.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const { turnTimerUnit } = await import('./index.js')

const root = join(homedir(), '.dsh', 'sessions', '--Users-leixuyang-Documents-deepseek-harness-default-workspace--')
const file = (argument) => argument.replace(/^~/, homedir())
const supplied = process.argv.slice(2).map(file)
const chosen = supplied.length > 0
  ? supplied
  : readdirSync(root)
      .map((id) => join(root, id, 'session.v4.jsonl.zstd'))
      .filter((path) => { try { return statSync(path).isFile() } catch { return false } })
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
      .slice(0, 3)

let failures = 0
let inspected = 0
const check = (label, condition, detail) => {
  if (condition) { console.log('  PASS', label); return }
  failures++
  console.log('  FAIL', label, detail === undefined ? '' : `-> ${detail}`)
}

for (const path of chosen) {
  const raw = zstdDecompressSync(readFileSync(path)).toString('utf8')
  const events = raw.split('\n').filter((line) => line !== '').flatMap((line) => {
    try { return [JSON.parse(line)] } catch { return [] }
  })
  /* The durable log is an envelope per line; the fold reads the event itself. */
  const folded = events.map((record) => (record.type === undefined && record.event !== undefined ? record.event : record))
  const turns = folded.filter((event) => event.type === 'turn/start').length

  let state = turnTimerUnit.init()
  for (const event of folded) state = turnTimerUnit.apply(state, event)
  const view = turnTimerUnit.view(state)
  const validated = (() => { try { turnTimerUnit.stateSchema.parse(view); return true } catch { return false } })()

  /* Independent expectation: the last complete turn pair in the log. */
  let expected = null
  let start = null
  let turn = 0
  for (const event of folded) {
    if (event.type === 'turn/start') { start = event.time; turn = event.data.turn }
    else if (event.type === 'turn/end' && start !== null) { expected = { lastMs: event.time - start, turn }; start = null }
  }

  if (expected !== null) inspected++
  const name = path.split('/').at(-2)
  console.log(`\n${name} (${folded.length} events, ${turns} turns)`)
  console.log(`  folded : ${JSON.stringify(view)}`)
  console.log(`  expected: ${JSON.stringify(expected)}`)
  check('the view validates', validated)
  if (expected === null) {
    check('a log with no completed turn reads as empty', view.lastMs === null, JSON.stringify(view))
  } else {
    check('elapsed time matches the last turn pair', view.lastMs === expected.lastMs, `${view.lastMs} vs ${expected.lastMs}`)
    check('turn number matches the log', view.turn === expected.turn, `${view.turn} vs ${expected.turn}`)
    check('a completed turn is not older than its own end', view.at !== null && view.lastMs !== null)
  }
}

console.log(failures === 0 ? '\nREAL-DATA PASSED' : `\n${failures} CHECK(S) FAILED`)
if (inspected === 0) console.log('(no log carried a completed turn; only the empty reading was checked)')
process.exit(failures === 0 ? 0 : 1)
