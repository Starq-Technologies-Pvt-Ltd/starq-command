/**
 * Cross-boot closeout proof — READ-ONLY and FAIL-CLOSED.
 *
 * A Windows Job Object, and every process inside it, is a kernel object. A
 * reboot destroys all of them unconditionally. So when the machine booted
 * AFTER a child was launched, that child's whole process family is gone as a
 * matter of kernel semantics, and no receipt is needed to know it.
 *
 * Why this exists. The guardian proves closeout by writing a `closed.json`
 * receipt during an orderly stop. An unclean shutdown — reboot, power loss,
 * crash — never writes it, so a later `JobGuardian query` answers
 * `{owned:false, closed:false, error:"Could not find file ...closed.json"}`.
 * `windows-containment.status()` collapses that error into `closed:false`,
 * which is the SAME value it reports for a family that is genuinely still
 * open. `treeClosed()` reads `closed === true`, so an unprovable child and a
 * running child become indistinguishable, and the recorded runtime can never
 * be settled: `stop` ends STOP_INCOMPLETE ("root absent; descendant closeout
 * unproven") and `start` then refuses ("previous runtime is READY with
 * unsettled children") for as long as the state file survives.
 *
 * This module does NOT relax ownership and does NOT make the guardian's proof
 * optional. It supplies a SECOND, independently falsifiable proof, consulted
 * only after the kernel proof has already declined, and it refuses unless
 * every one of these holds:
 *
 *   1. the child records a parseable launch time;
 *   2. the system booted strictly later than that launch time, by more than
 *      SKEW_MARGIN_MS (so a near-boundary reading is never treated as proof);
 *   3. the recorded root PID is not a live match for the recorded executable
 *      and creation time — a reused PID is FOREIGN, which is still not ours;
 *   4. nothing holds a listener on the child's recorded port.
 *
 * Any unknown — unreadable uptime, missing timestamp, failed inspection,
 * failed netstat — returns NOT PROVEN. The verdict carries its own basis so
 * the decision is journalled and auditable rather than silently assumed.
 */
import os from 'node:os';
import { osVerdict } from './inspect.mjs';

/**
 * Uptime is sampled in whole seconds and the wall clock can be adjusted, so a
 * boot time that lands within this margin of the launch time is treated as
 * unproven rather than as proof.
 */
export const SKEW_MARGIN_MS = 60_000;

/** Boot time derived from uptime. Returns null when it cannot be read. */
export function systemBootTime({ uptimeSeconds = () => os.uptime(), now = () => Date.now() } = {}) {
  try {
    const up = uptimeSeconds();
    if (!Number.isFinite(up) || up < 0) return null;
    return new Date(now() - up * 1000);
  } catch {
    return null;
  }
}

function parsedTime(value) {
  if (typeof value !== 'string' || !value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

const notProven = (reason, basis = {}) => ({ proven: false, reason, basis });

/**
 * Decide whether a recorded child's family is provably gone because the system
 * rebooted after it was launched.
 *
 * @param {object}   child          the recorded child from lifecycle state
 * @param {object}   ctx
 * @param {string}   ctx.expectedExe  executable the launch is pinned to
 * @param {number?}  ctx.port         the child's recorded listener port, if any
 * @param {Function} ctx.inspect      (pids) => Map<pid, info>
 * @param {Function} ctx.listListeners () => [{ port, pid }]
 * @param {Date?}    ctx.bootTime     injectable for tests
 * @returns {Promise<{proven: boolean, reason: string, basis: object}>}
 */
export async function provablyGoneAcrossBoot(child, {
  expectedExe,
  port = null,
  inspect,
  listListeners,
  bootTime = systemBootTime(),
} = {}) {
  if (!child) return notProven('no child record');

  const launchedAt = parsedTime(child.launched_at) ?? parsedTime(child.created_at);
  if (launchedAt === null) return notProven('child records no parseable launch time');
  if (!(bootTime instanceof Date) || !Number.isFinite(bootTime.getTime())) {
    return notProven('system boot time unreadable');
  }

  const basis = {
    launched_at: new Date(launchedAt).toISOString(),
    system_boot_time: bootTime.toISOString(),
    skew_margin_ms: SKEW_MARGIN_MS,
  };

  const bootedAfterBy = bootTime.getTime() - launchedAt;
  basis.booted_after_launch_by_ms = bootedAfterBy;
  if (bootedAfterBy <= SKEW_MARGIN_MS) {
    return notProven('system did not boot after this launch by a margin that excludes clock skew', basis);
  }

  // The reboot alone is decisive for the recorded family, but a PID that is
  // alive and still matches the recorded identity would contradict the record
  // itself. Refuse rather than explain away a contradiction.
  if (Number.isInteger(child.pid)) {
    let info;
    try {
      info = (await inspect([child.pid])).get(child.pid);
    } catch (err) {
      return notProven(`root inspection failed: ${err.message}`, basis);
    }
    const v = osVerdict(child, info, expectedExe);
    basis.root_verdict = v.verdict;
    basis.root_detail = v.detail;
    if (v.verdict === 'MATCH') {
      return notProven('recorded root is alive and matches the record, which contradicts the reboot', basis);
    }
    if (v.verdict === 'UNKNOWN') {
      return notProven(`recorded root is not classifiable: ${v.detail}`, basis);
    }
  }

  // A listener on the recorded port would mean something still occupies the
  // component's socket. Whose it is does not matter here: we will not claim a
  // clean closeout over an occupied port.
  if (Number.isInteger(port)) {
    let rows;
    try {
      rows = await listListeners();
    } catch (err) {
      return notProven(`listener inspection failed: ${err.message}`, basis);
    }
    const holders = (rows ?? []).filter((r) => r.port === port);
    basis.port = port;
    basis.port_listener_pids = holders.map((r) => r.pid);
    if (holders.length) {
      return notProven('recorded port still has a listener', basis);
    }
  }

  return {
    proven: true,
    reason: 'system booted after this launch; every process and kernel job from it is gone',
    basis,
  };
}
