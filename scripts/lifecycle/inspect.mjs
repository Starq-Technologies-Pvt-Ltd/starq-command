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
  "    $out+=[pscustomobject]@{pid=[int]$i;found=$true;name=$p.Name;exe=$p.ExecutablePath;ppid=[int]$p.ParentProcessId;created=$c} }",
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
