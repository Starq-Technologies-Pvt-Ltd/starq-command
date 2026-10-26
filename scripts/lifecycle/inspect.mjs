/**
 * Read-only OS inspection for the lifecycle owner.
 *
 * Every function either returns a COMPLETE answer or throws InspectionError.
 * There is no "error -> empty result" path: a failed process query or a failed
 * netstat must never read as "nothing is running / nothing is listening".
 */
import { execFile } from 'node:child_process';
import path from 'node:path';

export class InspectionError extends Error {
  constructor(message) { super(message); this.name = 'InspectionError'; }
}

// Fixed script; pids arrive through the environment, never as script text.
const PROCESS_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "$out=@()",
  "foreach($i in ($env:STARQ_LC_PIDS -split ',')){",
  "  $p=Get-CimInstance Win32_Process -Filter \"ProcessId=$i\"",
  "  if($p){ $c=$null; if($p.CreationDate){ $c=$p.CreationDate.ToUniversalTime().ToString('o') }",
  "    $out+=[pscustomobject]@{pid=[int]$i;found=$true;name=$p.Name;exe=$p.ExecutablePath;ppid=[int]$p.ParentProcessId;created=$c;cmd=[string]$p.CommandLine} }",
  "  else { $out+=[pscustomobject]@{pid=[int]$i;found=$false} }",
  "}",
  "[Console]::Out.Write((ConvertTo-Json -InputObject @($out) -Compress -Depth 3))",
].join('\n');

function runPowerShell(script, env, { execFileImpl = execFile, timeoutMs = 15000, powershellExe = 'powershell.exe' } = {}) {
  return new Promise((resolve, reject) => {
    execFileImpl(powershellExe, ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, ...env }, windowsHide: true, shell: false, timeout: timeoutMs, maxBuffer: 4 << 20,
    }, (err, stdout, stderr) => {
      if (err) { reject(new InspectionError(`process inspection failed: ${String(stderr || err.message).trim()}`)); return; }
      resolve(String(stdout));
    });
  });
}

/**
 * @returns {Promise<Map<number, {pid, found, name?, exe?, ppid?, created?}>>}
 */
export async function inspectProcesses(pids, opts = {}) {
  const list = [...new Set(pids)];
  for (const pid of list) if (!Number.isInteger(pid) || pid <= 0) throw new InspectionError(`invalid pid ${JSON.stringify(pid)}`);
  const result = new Map();
  if (!list.length) return result;
  const text = await runPowerShell(PROCESS_SCRIPT, { STARQ_LC_PIDS: list.join(',') }, opts);
  let rows;
  try { rows = JSON.parse(text); } catch { throw new InspectionError(`process inspection returned unparseable output: ${text.slice(0, 200)}`); }
  if (!Array.isArray(rows)) rows = [rows];
  for (const r of rows) result.set(r.pid, r);
  for (const pid of list) if (!result.has(pid)) throw new InspectionError(`process inspection omitted pid ${pid}`);
  return result;
}

/** All TCP listeners (IPv4 + IPv6). Throws rather than returning a partial table. */
export async function listListeners({ execFileImpl = execFile, netstatExe = 'netstat.exe' } = {}) {
  const rows = [];
  for (const proto of ['tcp', 'tcpv6']) {
    const text = await new Promise((resolve, reject) => {
      execFileImpl(netstatExe, ['-ano', '-p', proto], { windowsHide: true, shell: false, timeout: 15000, maxBuffer: 8 << 20 },
        (err, stdout) => (err ? reject(new InspectionError(`netstat ${proto} failed: ${err.message}`)) : resolve(String(stdout))));
    });
    if (!/Proto\s+Local Address/i.test(text)) throw new InspectionError(`netstat ${proto} output not recognised`);
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line);
      if (m) rows.push({ address: m[1], port: Number(m[2]), pid: Number(m[3]) });
    }
  }
  return rows;
}

export function sameExe(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

const INFRASTRUCTURE_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "$herdr=$env:STARQ_LC_HERDR",
  "$scripts=$env:STARQ_LC_SCRIPTS",
  "$out=@()",
  "foreach($p in (Get-CimInstance Win32_Process)){",
  "  $exe=[string]$p.ExecutablePath; $cmd=[string]$p.CommandLine; $hit=$false",
  "  if($herdr -and $exe){ try { if([IO.Path]::GetFullPath($exe).ToLower() -eq [IO.Path]::GetFullPath($herdr).ToLower()){ $hit=$true } } catch {} }",
  "  if(-not $hit -and $exe){",
  "    $base=[IO.Path]::GetFileName($exe)",
  "    if($base -ieq 'node.exe' -or $base -ieq 'cmd.exe'){ $hit=$true }",
  "  }",
  "  if($hit){ $c=$null; if($p.CreationDate){ $c=$p.CreationDate.ToUniversalTime().ToString('o') }",
  "    $out+=[pscustomobject]@{pid=[int]$p.ProcessId;found=$true;name=$p.Name;exe=$exe;ppid=[int]$p.ParentProcessId;created=$c;cmd=$cmd} }",
  "}",
  "[Console]::Out.Write((ConvertTo-Json -InputObject @($out) -Compress -Depth 3))",
].join('\n');

const NODE_SCRIPT_IDS = new Map([
  ['room-watch-codex.mjs', 'room-watcher'],
  ['room-watch-antigravity.mjs', 'room-watcher'],
  ['starq-bot-gateway.mjs', 'starqbot-gateway'],
  ['gateway-supervisor.mjs', 'starqbot-gateway'],
]);
const CMD_SCRIPT_IDS = new Map([
  ['run-persistent-starq-bot.cmd', 'starqbot-gateway'],
]);

function isNodeExecutable(exe) {
  return typeof exe === 'string' && path.basename(exe).toLowerCase() === 'node.exe';
}

function isCmdExecutable(exe) {
  return typeof exe === 'string' && path.basename(exe).toLowerCase() === 'cmd.exe';
}

/** Windows-style argv: quoted tokens keep interior spaces; quotes are stripped. */
function tokenizeCommandLine(cmd) {
  const tokens = [];
  const text = String(cmd || '');
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (i >= text.length) break;
    if (text[i] === '"') {
      let buf = '';
      i += 1;
      while (i < text.length && text[i] !== '"') {
        buf += text[i];
        i += 1;
      }
      if (text[i] === '"') i += 1;
      tokens.push(buf);
    } else {
      let buf = '';
      while (i < text.length && !/\s/.test(text[i])) {
        buf += text[i];
        i += 1;
      }
      tokens.push(buf);
    }
  }
  return tokens;
}

const NODE_EVAL_FLAGS = new Set(['-e', '--eval', '-p', '--print', '-c', '--check']);
const NODE_VALUE_FLAGS = new Set([
  '-e', '--eval', '-p', '--print', '-r', '--require', '--import',
  '-C', '--conditions', '--loader', '--experimental-loader',
  '--inspect-port', '--title', '--env-file', '--input-type',
  '--icu-data-dir', '--report-dir', '--redirect-warnings',
]);

function skipLeadingExecutable(tokens, kind) {
  if (!tokens.length) return 0;
  const base = path.basename(tokens[0]).toLowerCase();
  if (kind === 'node' && (base === 'node.exe' || base === 'node')) return 1;
  if (kind === 'cmd' && (base === 'cmd.exe' || base === 'cmd')) return 1;
  return 0;
}

function nodeLaunchedEntrypoint(cmd) {
  const tokens = tokenizeCommandLine(cmd);
  let i = skipLeadingExecutable(tokens, 'node');
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === '-' || token === '--') {
      i += 1;
      break;
    }
    if (!token.startsWith('-')) break;
    const eq = token.indexOf('=');
    const flag = (eq === -1 ? token : token.slice(0, eq)).toLowerCase();
    if (NODE_EVAL_FLAGS.has(flag)) return null;
    if (eq !== -1) {
      i += 1;
      continue;
    }
    if (NODE_VALUE_FLAGS.has(flag)) {
      i += 2;
      continue;
    }
    i += 1;
  }
  return tokens[i] ?? null;
}

function cmdLaunchedEntrypoint(cmd) {
  const tokens = tokenizeCommandLine(cmd);
  let i = skipLeadingExecutable(tokens, 'cmd');
  while (i < tokens.length) {
    const token = tokens[i];
    const lower = token.toLowerCase();
    if (lower === '/c' || lower === '/k') return tokens[i + 1] ?? null;
    if (lower.startsWith('/')) {
      i += 1;
      continue;
    }
    return token;
  }
  return null;
}

function identityForEntrypoint(entrypoint, scriptsRoot, ids) {
  if (!entrypoint || typeof scriptsRoot !== 'string' || !scriptsRoot.trim()) return null;
  let resolved;
  try { resolved = path.resolve(entrypoint); } catch { return null; }
  if (path.dirname(resolved).toLowerCase() !== path.resolve(scriptsRoot).toLowerCase()) return null;
  return ids.get(path.basename(resolved).toLowerCase()) ?? null;
}

function nodeScriptIdentity(exe, cmd, scriptsRoot) {
  if (!isNodeExecutable(exe)) return null;
  return identityForEntrypoint(nodeLaunchedEntrypoint(cmd), scriptsRoot, NODE_SCRIPT_IDS);
}

function cmdScriptIdentity(exe, cmd, scriptsRoot) {
  if (!isCmdExecutable(exe)) return null;
  return identityForEntrypoint(cmdLaunchedEntrypoint(cmd), scriptsRoot, CMD_SCRIPT_IDS);
}

/**
 * Read-only scan of declared Starq infrastructure processes. Never signals.
 * Identity is executable/script path, never a pinned PID.
 */
export async function inspectDeclaredInfrastructure({ herdrExecutable, scriptsRoot } = {}, opts = {}) {
  const text = await runPowerShell(INFRASTRUCTURE_SCRIPT, {
    STARQ_LC_HERDR: herdrExecutable || '',
    STARQ_LC_SCRIPTS: scriptsRoot || '',
  }, opts);
  let rows;
  try { rows = JSON.parse(text); } catch { throw new InspectionError(`infrastructure inspection returned unparseable output: ${text.slice(0, 200)}`); }
  if (!Array.isArray(rows)) rows = rows ? [rows] : [];
  return rows;
}

/**
 * Classify a live process as declared Starq infrastructure vs unclassified.
 * Watchers/gateway require node.exe (or cmd.exe for the .cmd launcher) AND the
 * launched entrypoint (first node script argument / cmd /c|/k target) to resolve
 * under agent-comms/scripts. A later argument that happens to name a Starq
 * script is not identity.
 * PIDs are never pinned. This does NOT grant Command ownership and does NOT
 * exempt a process that is listening on a Command control-plane port.
 */
export function classifyInfrastructureProcess({ name, exe, cmd } = {}, { herdrExecutable, scriptsRoot } = {}) {
  if (herdrExecutable && sameExe(exe, herdrExecutable)) {
    return { kind: 'DECLARED_EXTERNAL_INFRASTRUCTURE', id: 'standalone-herdr', blocking_for_command: false };
  }
  const scriptId = nodeScriptIdentity(exe, cmd, scriptsRoot) || cmdScriptIdentity(exe, cmd, scriptsRoot);
  if (scriptId) return { kind: 'DECLARED_EXTERNAL_INFRASTRUCTURE', id: scriptId, blocking_for_command: false };
  return { kind: 'NOT_CLASSIFIED', id: null, blocking_for_command: null, name: name ?? null };
}

/**
 * Ownership verdict for a recorded child from the OS facts alone.
 *   GONE      the pid no longer exists
 *   FOREIGN   the pid exists but is a different process (exe or creation time differ):
 *             the original has necessarily exited; the pid was reused
 *   UNKNOWN   cannot tell (no inspection data, inaccessible process, or the record
 *             never captured the creation identity)
 *   MATCH     exact executable and exact creation time match the record
 * MATCH is necessary but NOT sufficient for OWNED: the control-pipe instance proof
 * (control.mjs) completes ownership.
 */
export function osVerdict(child, info, expectedExe) {
  if (!info) return { verdict: 'UNKNOWN', detail: 'no inspection data' };
  if (!info.found) return { verdict: 'GONE', detail: 'process not present' };
  if (!info.exe || !info.created) return { verdict: 'UNKNOWN', detail: 'process present but not inspectable (executable or creation time unreadable)' };
  if (!child.created_at || !child.exe) return { verdict: 'UNKNOWN', detail: 'record has no creation identity (launch never identified)' };
  if (!sameExe(info.exe, expectedExe) || !sameExe(info.exe, child.exe)) {
    return { verdict: 'FOREIGN', detail: `executable ${info.exe} != recorded ${child.exe}` };
  }
  if (info.created !== child.created_at) {
    return { verdict: 'FOREIGN', detail: `creation time ${info.created} != recorded ${child.created_at} (pid reused)` };
  }
  return { verdict: 'MATCH', detail: 'exact executable and creation time' };
}
