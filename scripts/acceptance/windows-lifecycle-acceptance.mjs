#!/usr/bin/env node
/**
 * Windows daily-driver lifecycle acceptance, against a DISPOSABLE workspace.
 *
 * WHY A WORKSPACE, NOT AN ENV VAR
 * The lifecycle loads every component from the workspace named in its config,
 * and PM's health contract demands scratch:false, which pins PM to a database
 * chosen by WHERE ITS CODE LIVES (server/paths.mjs resolves upward from the
 * module's own location). So launching the lifecycle from any worktree still ran
 * the CANONICAL checkout's code against the LIVE database, which is how an earlier
 * start appended 1,345 redundant provenance rows. An environment variable cannot
 * isolate that.
 *
 * So this builds a copy of the committed files inside the real workspace root
 * (under _scratch), in a directory carrying the markers paths.mjs looks for, and
 * points ONLY the component entry paths at that copy. The lifecycle's
 * workspace_root stays the REAL one, so the real containment pins, companions and
 * gates run unmodified (they are keyed by absolute path and cannot be relocated;
 * regenerating them would make the gate meaningless), while everything mutable -
 * the code under test, the database, runtime state, backups and locks - is
 * disposable. Isolation is PROVEN before anything starts, not assumed: the harness
 * resolves the database path from inside the copy and refuses to continue unless
 * it is the copy's own, and the live database is hashed before and after.
 *
 * WHAT IT PROVES, through the real one-click path (Start-Command.bat)
 *   start   one click reaches READY; each required child proves ownership over
 *           the authenticated control pipe; the UI answers over HTTP
 *   data    optionally seeded from a restored copy of the real database; counts
 *           and the append-only ledger are compared before and after
 *   stop    owned children exit, their ports are free, nothing is left running
 *   cycle   restart, and recovery after a child is killed out from under it
 *
 * SAFETY
 *   - never opens or writes the live database; the seed is read with a read-only
 *     handle and copied with VACUUM INTO
 *   - never matches processes by name; every signal is to a PID recorded in the
 *     lifecycle's own state file, and only after confirming it is still our node
 *   - refuses to start if the Command ports are already held by anything else
 *
 * Usage:
 *   node scripts/acceptance/windows-lifecycle-acceptance.mjs full --ws <dir> [--seed <db>] [--keep]
 *   node scripts/acceptance/windows-lifecycle-acceptance.mjs build|start|status|stop|teardown --ws <dir> [--seed <db>]
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWorkspace } from '../../server/paths.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GIT = fs.existsSync('C:\\Program Files\\Git\\cmd\\git.exe') ? 'C:\\Program Files\\Git\\cmd\\git.exe' : 'git';
const COMMAND_PORTS = { ui: 5173, pm: 5176, data: 5177 };
const PROFILE_CONFIG = 'lifecycle.command-local.config.json';

const argv = process.argv.slice(2);
const command = argv[0] ?? 'full';
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const has = (name) => argv.includes(name);
const WS = path.resolve(flag('--ws') ?? '');
const SEED = flag('--seed') ? path.resolve(flag('--seed')) : null;

const results = [];
const pass = (name, detail = '') => { results.push({ name, ok: true, detail }); console.log(`PASS  ${name}${detail ? `  ${detail}` : ''}`); };
const fail = (name, detail = '') => { results.push({ name, ok: false, detail }); console.log(`FAIL  ${name}${detail ? `  ${detail}` : ''}`); };
const check = (ok, name, detail) => (ok ? pass(name, detail) : fail(name, detail));

// ── paths ──────────────────────────────────────────────────────────────────
const APP = () => path.join(WS, '00_STARQ_HQ', 'operations', 'starq-command');
const DB = () => path.join(APP(), 'data', 'pm-operating.db');
const STATE = () => path.join(APP(), '.command-runtime-local', 'state.json');
const real = () => { const r = resolveWorkspace(); if (!r.root) throw new Error(`real workspace unresolved: ${r.source}`); return r.root; };

const MARKER_TEXT = 'Disposable acceptance workspace';

function requireWs() {
  if (!flag('--ws')) throw new Error('--ws <dir> is required');
  const realRoot = real();
  const rel = path.relative(realRoot, WS);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`the disposable workspace must live INSIDE the real workspace root (${realRoot}), under _scratch, so component paths can be relative to it: ${WS}`);
  }
  if (rel.toLowerCase().startsWith('00_starq_hq')) {
    throw new Error(`refusing to use anything inside the real 00_STARQ_HQ: ${WS}`);
  }
  // Only ever build into, or delete, a directory that is absent, empty, or that
  // this script created. Anything else is somebody's data.
  if (fs.existsSync(WS) && fs.readdirSync(WS).length > 0) {
    const marker = path.join(WS, 'STARQ.md');
    const ours = fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').includes(MARKER_TEXT);
    if (!ours) throw new Error(`refusing to use a non-empty directory this script did not create: ${WS}`);
  }
}

// ── build the disposable workspace ─────────────────────────────────────────
function git(args) {
  return execFileSync(GIT, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20 });
}

function build() {
  requireWs();
  const dirty = git(['status', '--porcelain']).split('\n').filter((l) => l.trim() && !/\.lead-scratch\/|\.review-scratch\//.test(l));
  if (dirty.length && !has('--allow-dirty')) {
    throw new Error(`working tree is not clean, so the copy would not be the committed SHA:\n${dirty.slice(0, 8).join('\n')}`);
  }
  const sha = git(['rev-parse', 'HEAD']).trim();
  fs.mkdirSync(APP(), { recursive: true });
  fs.writeFileSync(path.join(WS, 'STARQ.md'), '# Disposable acceptance workspace\n\nNot the Founder\'s workspace. Safe to delete.\n');

  const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
  for (const rel of tracked) {
    const src = path.join(REPO, rel);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    const dest = path.join(APP(), rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  // Read-only companions and dependencies, reached through junctions so nothing
  // is duplicated and the real ones are only ever read.
  const realApp = path.join(real(), '00_STARQ_HQ', 'operations');
  const link = (target, at) => {
    fs.mkdirSync(path.dirname(at), { recursive: true });
    if (!fs.existsSync(at)) fs.symlinkSync(target, at, 'junction');
  };
  link(path.join(realApp, 'starq-command', 'node_modules'), path.join(APP(), 'node_modules'));
  link(path.join(realApp, 'herdr-floor'), path.join(WS, '00_STARQ_HQ', 'operations', 'herdr-floor'));
  link(path.join(realApp, 'starq-lifecycle'), path.join(WS, '00_STARQ_HQ', 'operations', 'starq-lifecycle'));
  fs.mkdirSync(path.join(WS, '_scratch', 'STARQ-COMMAND-DEVELOPMENT-READINESS-IMPLEMENTATION-2026-10-27'), { recursive: true });

  // workspace_root stays the REAL one. Only the component paths move: each is
  // workspace-relative, so rebasing the starq-command prefix onto the copy makes
  // the lifecycle launch OUR code while the real pins, companions and gates run
  // unmodified.
  const cfgPath = path.join(APP(), PROFILE_CONFIG);
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const canonicalPrefix = '00_STARQ_HQ\\operations\\starq-command';
  const copyPrefix = path.relative(real(), APP());
  const rebase = (v) => (typeof v === 'string' && v.toLowerCase().startsWith(canonicalPrefix.toLowerCase()) ? copyPrefix + v.slice(canonicalPrefix.length) : v);
  cfg.workspace_root = real();
  for (const c of cfg.components) for (const k of ['entry', 'cwd', 'vite_config']) if (c[k]) c[k] = rebase(c[k]);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

  fs.mkdirSync(path.dirname(DB()), { recursive: true });
  if (SEED) {
    const src = new DatabaseSync(SEED, { readOnly: true });
    try { src.exec(`VACUUM INTO '${DB().split(path.sep).join('/')}'`); } finally { src.close(); }
  }
  pass('build', `workspace ${WS} from ${sha.slice(0, 7)}, ${tracked.length} tracked files${SEED ? ', seeded from a read-only copy' : ', empty database'}`);
  return sha;
}

/** A broken precondition: nothing after it would mean anything, so stop and say so. */
class Halt extends Error {}
const must = (ok, name, detail) => { check(ok, name, detail); if (!ok) throw new Halt(name); };


// ── isolation proof and live-data guard ───────────────────────────────────
function liveDbPath() {
  return path.join(real(), '00_STARQ_HQ', 'operations', 'starq-command', 'data', 'pm-operating.db');
}

/** Hash the Founder's live database and note its sidecar sizes. Read-only. */
function liveSnapshot() {
  const file = liveDbPath();
  if (!fs.existsSync(file)) return { present: false };
  const sidecar = (ext) => { try { return fs.statSync(file + ext).size; } catch { return null; } };
  return {
    present: true,
    sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    bytes: fs.statSync(file).size,
    wal: sidecar('-wal'),
    shm: sidecar('-shm'),
  };
}

/**
 * Resolve the database path from INSIDE the copy, exactly as PM will, and refuse
 * to go on unless it is the copy's own. Run before any service starts, because
 * the cost of being wrong is a service opening the Founder's database.
 */
function proveIsolation() {
  const probe = [
    "import { resolveWorkspace, CANONICAL, abs } from './server/paths.mjs';",
    'const r = resolveWorkspace();',
    'console.log(JSON.stringify({ root: r.root, source: r.source, db: r.root ? abs(r.root, CANONICAL.pmBoardDb) : null }));',
  ].join(' ');
  const r = spawnSync(nodeExe(), ['--input-type=module', '-e', probe], { cwd: APP(), env: cleanEnv(), encoding: 'utf8', windowsHide: true });
  let got = null; try { got = JSON.parse(String(r.stdout).trim()); } catch { /* handled below */ }
  const sameRoot = got?.root && path.resolve(got.root).toLowerCase() === WS.toLowerCase();
  const sameDb = got?.db && path.resolve(got.db).toLowerCase() === DB().toLowerCase();
  must(Boolean(sameRoot && sameDb), 'isolation: the copy resolves ITS OWN database, not the Founder\'s', `root=${got?.root} db=${got?.db} source=${got?.source}`);

  // And no component may be launched from anywhere but the copy.
  const cfg = JSON.parse(fs.readFileSync(path.join(APP(), PROFILE_CONFIG), 'utf8'));
  const stray = [];
  for (const c of cfg.components) {
    const entry = path.resolve(cfg.workspace_root, c.entry).toLowerCase();
    if (!entry.startsWith(APP().toLowerCase() + path.sep)) stray.push(`${c.name}: ${entry}`);
  }
  must(stray.length === 0, 'isolation: every component launches from the disposable copy', stray.join(' | ') || `${cfg.components.length} components`);
}

// ── helpers ────────────────────────────────────────────────────────────────
const cleanEnv = () => {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    const u = k.toUpperCase();
    if (u.startsWith('NODE_') || u.startsWith('VITE_') || u.startsWith('STARQ_') || u.startsWith('PM_') || u.startsWith('COMMAND_')) continue;
    if (['HOST', 'PORT', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'].includes(u)) continue;
    env[k] = v;
  }
  return env;
};

function nodeExe() {
  return JSON.parse(fs.readFileSync(path.join(APP(), PROFILE_CONFIG), 'utf8')).node;
}

function lifecycle(sub, extra = []) {
  const t0 = Date.now();
  const r = spawnSync(nodeExe(), [path.join(APP(), 'scripts', 'command-lifecycle.mjs'), sub, ...extra], {
    cwd: APP(), env: cleanEnv(), encoding: 'utf8', windowsHide: true, timeout: 240_000,
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(), ms: Date.now() - t0 };
}

const portFree = (port) => new Promise((resolve) => {
  const probe = createServer();
  probe.once('error', () => resolve(false));
  probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
});

async function http(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'x-pm-client': 'starq-command', origin: 'http://127.0.0.1:5173' } });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, text, json };
  } catch (e) { return { status: 0, text: String(e.message), json: null }; }
}

const readState = () => { try { return JSON.parse(fs.readFileSync(STATE(), 'utf8')); } catch { return null; } };

function children() {
  const s = readState();
  return (s?.children ?? []).map((c) => ({ name: c.name, pid: c.pid, status: c.status, bound: c.bound_addresses }));
}

/**
 * Is `pid` alive, a node.exe, AND running something from THIS disposable
 * workspace? The command line check is read-only and is what makes it safe to
 * signal a recorded PID: a recycled PID belonging to some other node process
 * will not name our workspace path.
 */
function isOurNode(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue; if ($p -and $p.Name -eq 'node.exe') { $p.CommandLine } else { '' }`],
  { encoding: 'utf8', windowsHide: true });
  const cmd = String(r.stdout ?? '').trim().toLowerCase();
  return cmd.length > 0 && cmd.includes(WS.toLowerCase());
}

function dbCounts() {
  if (!fs.existsSync(DB())) return null;
  const db = new DatabaseSync(DB(), { readOnly: true });
  try {
    const n = (sql) => { try { return Number(db.prepare(sql).get().n); } catch { return null; } };
    return {
      projects: n('SELECT COUNT(*) n FROM pm_projects'),
      tasks: n('SELECT COUNT(*) n FROM pm_tasks'),
      status_log: n('SELECT COUNT(*) n FROM pm_status_log'),
      source_records: n('SELECT COUNT(*) n FROM pm_source_records'),
      source_versions: n('SELECT COUNT(*) n FROM pm_source_record_versions'),
      companies: n('SELECT COUNT(*) n FROM org_companies'),
      people: n('SELECT COUNT(*) n FROM org_people'),
      provisioning: (() => { try { return db.prepare("SELECT value v FROM pm_meta WHERE key='provisioning'").get()?.v ?? null; } catch { return null; } })(),
    };
  } finally { db.close(); }
}

const sameCounts = (a, b, keys) => keys.every((k) => a?.[k] === b?.[k]);

// ── phases ─────────────────────────────────────────────────────────────────
async function assertPortsFree(label) {
  const held = [];
  for (const [name, port] of Object.entries(COMMAND_PORTS)) if (!(await portFree(port))) held.push(`${name}:${port}`);
  check(held.length === 0, label, held.length ? `held by something else: ${held.join(', ')}` : 'ui 5173, pm 5176, data 5177 all free');
  return held.length === 0;
}

/** Any process at all whose command line names this disposable workspace. Read-only; never used to signal. */
function strayProcesses() {
  const needle = WS.toLowerCase().replace(/'/g, "''");
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains('${needle}') } | ForEach-Object { "$($_.ProcessId):$($_.Name)" }`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true });
  return String(r.stdout ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

async function verifyRunning(label, baseline) {
  const st = lifecycle('local-status', ['--json']);
  let parsed = null; try { parsed = JSON.parse(st.out); } catch { /* reported below */ }
  must(parsed?.overall === 'RUNNING', `${label}: lifecycle reports RUNNING`, `overall=${parsed?.overall ?? 'unparseable'} exit=${st.code}`);

  const kids = children();
  for (const name of ['data', 'pm', 'ui']) {
    const c = kids.find((k) => k.name === name);
    const port = COMMAND_PORTS[name];
    const bound = Array.isArray(c?.bound) && c.bound.some((b) => b.port === port);
    must(Boolean(c) && c.status === 'READY' && bound, `${label}: ${name} READY, bound ${port} proven by the child itself`, c ? `pid=${c.pid} bound=${JSON.stringify(c.bound)}` : 'not recorded');
  }

  const ui = await http(`http://127.0.0.1:${COMMAND_PORTS.ui}/`);
  check(ui.status === 200 && ui.text.includes('<title>STARQ // COMMAND</title>'), `${label}: Command UI answers over HTTP`, `status=${ui.status}`);

  const pm = await http(`http://127.0.0.1:${COMMAND_PORTS.pm}/api/pm/health`);
  check(pm.json?.db?.toLowerCase() === DB().toLowerCase(), `${label}: PM serves THIS workspace's database, not the Founder's`, `reports ${pm.json?.db}`);
  check(pm.json?.state === 'OK' && pm.json?.scratch === false, `${label}: PM healthy in production mode`, `state=${pm.json?.state} scratch=${pm.json?.scratch}`);

  const data = await http(`http://127.0.0.1:${COMMAND_PORTS.data}/api/health`);
  check(data.status === 200, `${label}: data service answers`, `status=${data.status} overall=${data.json?.health?.overall}`);

  // Only meaningful because the stack is provably up: these compare what STARTUP did to the data.
  const now = dbCounts();
  if (!baseline) {
    check(now?.provisioning === 'empty' && now.projects === 0 && now.tasks === 0 && now.companies === 0, `${label}: a fresh installation holds NO organizational data`, `provisioning=${now?.provisioning} projects=${now?.projects} tasks=${now?.tasks} companies=${now?.companies}`);
  } else {
    check(sameCounts(baseline, now, ['projects', 'tasks', 'status_log', 'source_records']), `${label}: organizational records unchanged`, `projects ${baseline.projects}->${now.projects}, tasks ${baseline.tasks}->${now.tasks}, history ${baseline.status_log}->${now.status_log}`);
    check(now.source_versions === baseline.source_versions, `${label}: startup appended NO provenance-ledger rows (CV-C6 effective on this startup path)`, `source versions ${baseline.source_versions}->${now.source_versions}`);
  }
}

async function verifyStopped(label, priorKids) {
  must(priorKids.length > 0, `${label}: there were owned children to stop`, 'a stop that had nothing to stop proves nothing');
  const alive = priorKids.filter((c) => isOurNode(c.pid));
  must(alive.length === 0, `${label}: every owned child has exited`, alive.length ? `still alive: ${alive.map((c) => `${c.name}:${c.pid}`).join(', ')}` : priorKids.map((c) => `${c.name}:${c.pid}`).join(' '));
  must(await assertPortsFree(`${label}: Command ports are free again`), `${label}: ports released`);
  const stray = strayProcesses();
  check(stray.length === 0, `${label}: no process anywhere still names this workspace`, stray.length ? `stray: ${stray.join(', ')}` : 'none');
}

/** Terminate ONLY children recorded in our own state file, after re-confirming each is still ours. */
function killRecordedChildren(kids) {
  const killed = [];
  for (const c of kids) {
    if (!isOurNode(c.pid)) continue;
    process.kill(c.pid);
    killed.push(`${c.name}:${c.pid}`);
  }
  return killed;
}

async function waitDead(kids, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (!kids.some((c) => isOurNode(c.pid))) return true; await new Promise((r) => setTimeout(r, 300)); }
  return false;
}

/** Never leave a stack running because a check failed: try the supported stop, then recorded PIDs only. */
async function cleanupStack() {
  const kids = children().filter((c) => isOurNode(c.pid));
  if (!kids.length) return;
  console.log(`cleanup: ${kids.length} owned child(ren) still running; using the supported stop first`);
  lifecycle('local-stop');
  const left = children().filter((c) => isOurNode(c.pid));
  if (left.length) {
    console.log(`cleanup: supported stop left ${left.map((c) => `${c.name}:${c.pid}`).join(', ')}; signalling those recorded PIDs only`);
    killRecordedChildren(left);
    await waitDead(left);
  }
}

// ── commands ───────────────────────────────────────────────────────────────
async function runFull() {
  requireWs();
  let sha = 'unknown';
  let liveBefore = null;
  try {
    sha = build();
    liveBefore = liveSnapshot();
    console.log(`live database (guarded, never opened for writing): ${liveBefore.present ? `${liveBefore.bytes} bytes sha256 ${liveBefore.sha256.slice(0, 16)}...` : 'absent'}`);
    proveIsolation();
    must(await assertPortsFree('preflight: Command ports free'), 'preflight: ports available');

    const baseline = dbCounts();
    console.log(`baseline: ${JSON.stringify(baseline)}`);

    // 1. START through the real one-click launcher.
    const t0 = Date.now();
    const bat = spawnSync('cmd.exe', ['/d', '/c', path.join(APP(), 'Start-Command.bat')], {
      cwd: APP(), env: cleanEnv(), encoding: 'utf8', windowsHide: true, timeout: 300_000,
    });
    if (bat.status !== 0) console.log(`${bat.stdout}\n${bat.stderr}`.slice(0, 1800));
    must(bat.status === 0, 'one click: Start-Command.bat exits 0', `exit=${bat.status} in ${Date.now() - t0}ms`);
    await verifyRunning('after one-click start', baseline);
    const firstKids = children();

    // 2. STOP.
    const stop = lifecycle('local-stop');
    if (!(stop.code === 0 && /STOPPED/.test(stop.out))) console.log(stop.out.slice(0, 1500));
    must(stop.code === 0 && /STOPPED/.test(stop.out), 'stop: local-stop reports STOPPED', `exit=${stop.code} in ${stop.ms}ms`);
    await verifyStopped('after stop', firstKids);

    // 3. RESTART: data preserved, import not re-run.
    const restart = lifecycle('local-start');
    if (restart.code !== 0) console.log(restart.out.slice(0, 1500));
    must(restart.code === 0, 'restart: local-start reaches READY again', `exit=${restart.code} in ${restart.ms}ms`);
    await verifyRunning('after restart', baseline);

    // 4. RECOVERY: a child dies out from under the owner.
    const before = children();
    const pmKid = before.filter((c) => c.name === 'pm');
    const killed = killRecordedChildren(pmKid);
    must(killed.length === 1, 'recovery: killed the recorded pm child by exact PID', killed.join(', '));
    must(await waitDead(pmKid), 'recovery: the killed child is gone');
    const degraded = lifecycle('local-status', ['--json']);
    let dj = null; try { dj = JSON.parse(degraded.out); } catch { /* ignore */ }
    check(dj?.overall && dj.overall !== 'RUNNING', 'recovery: status no longer claims RUNNING', `overall=${dj?.overall}`);
    const stop2 = lifecycle('local-stop');
    if (!(stop2.code === 0 && /STOPPED/.test(stop2.out))) console.log(stop2.out.slice(0, 1500));
    must(stop2.code === 0 && /STOPPED/.test(stop2.out), 'recovery: local-stop settles the half-dead stack', `exit=${stop2.code}`);
    await verifyStopped('after recovery stop', before);
    const again = lifecycle('local-start');
    if (again.code !== 0) console.log(again.out.slice(0, 1500));
    must(again.code === 0, 'recovery: a fresh local-start succeeds afterwards', `exit=${again.code} in ${again.ms}ms`);
    await verifyRunning('after recovery restart', baseline);

    // 5. FINAL STOP and whole-run preservation.
    const lastKids = children();
    const stop3 = lifecycle('local-stop');
    must(stop3.code === 0 && /STOPPED/.test(stop3.out), 'final stop: STOPPED', `exit=${stop3.code} in ${stop3.ms}ms`);
    await verifyStopped('after final stop', lastKids);

    const end = dbCounts();
    console.log(`final:    ${JSON.stringify(end)}`);
    if (baseline && baseline.tasks) {
      check(sameCounts(baseline, end, ['projects', 'tasks', 'status_log', 'source_records', 'source_versions']), 'preservation: counts identical after every cycle', 'projects/tasks/history/source records/versions');
    }
  } catch (e) {
    if (e instanceof Halt) console.log(`\nHALTED at: ${e.message}. Later checks were NOT run, so no result below is claimed for them.`);
    else fail('harness error', e.stack ?? e.message);
  } finally {
    await cleanupStack();
    if (liveBefore) {
      const after = liveSnapshot();
      const same = after.present === liveBefore.present && after.sha256 === liveBefore.sha256 && after.wal === liveBefore.wal && after.shm === liveBefore.shm;
      check(same, "the Founder's LIVE database is byte-identical before and after", same ? `sha256 ${liveBefore.sha256?.slice(0, 16)}... unchanged` : `BEFORE ${JSON.stringify(liveBefore)} AFTER ${JSON.stringify(after)} (note: a real Command running meanwhile would also change this)`);
    }
    report(sha);
  }
}

function report(sha) {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed at ${String(sha).slice(0, 7)}`);
  if (failed.length) console.log(`FAILED: ${failed.map((f) => f.name).join(' | ')}`);
  const out = path.join(path.dirname(WS), `${path.basename(WS)}-acceptance-report.json`);
  fs.writeFileSync(out, JSON.stringify({ sha, at: new Date().toISOString(), results }, null, 2));
  console.log(`report: ${out}`);
  process.exitCode = failed.length ? 1 : 0;
}

async function main() {
  if (command === 'full') return runFull();
  requireWs();
  if (command === 'build') return build();
  if (command === 'start') { const r = lifecycle('local-start'); console.log(r.out); process.exitCode = r.code; return undefined; }
  if (command === 'status') { const r = lifecycle('local-status'); console.log(r.out); process.exitCode = r.code; return undefined; }
  if (command === 'stop') { const r = lifecycle('local-stop'); console.log(r.out); process.exitCode = r.code; return undefined; }
  if (command === 'teardown') {
    const alive = children().filter((c) => isOurNode(c.pid));
    if (alive.length) throw new Error(`children still running (${alive.map((c) => `${c.name}:${c.pid}`).join(', ')}); run stop first. Nothing was deleted.`);
    // Remove the junctions FIRST, as links, and prove the real directories they
    // pointed at are untouched before deleting anything else. A recursive delete
    // must never be the thing that decides whether a link is followed.
    const links = [
      path.join(APP(), 'node_modules'),
      path.join(WS, '00_STARQ_HQ', 'operations', 'herdr-floor'),
      path.join(WS, '00_STARQ_HQ', 'operations', 'starq-lifecycle'),
    ];
    const targets = links.map((l) => { try { return fs.realpathSync(l); } catch { return null; } });
    for (const l of links) {
      if (fs.existsSync(l) && fs.lstatSync(l).isSymbolicLink()) fs.unlinkSync(l);
      else if (fs.existsSync(l)) throw new Error(`expected a junction at ${l} but found a real directory; refusing to delete`);
    }
    for (const t of targets) if (t && !fs.existsSync(t)) throw new Error(`REAL directory vanished after unlinking a junction: ${t}`);
    fs.rmSync(WS, { recursive: true, force: true });
    for (const t of targets) if (t && !fs.existsSync(t)) throw new Error(`REAL directory vanished during teardown: ${t}`);
    console.log(`removed ${WS}; ${targets.filter(Boolean).length} linked real directories verified intact`);
    return undefined;
  }
  throw new Error(`unknown command ${command}`);
}

main().catch((e) => { console.error(`acceptance error: ${e.message}`); process.exitCode = 2; });
