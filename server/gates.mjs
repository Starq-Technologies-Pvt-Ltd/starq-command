/**
 * STARQ // COMMAND — read-only reconciliation gates.
 *
 * The control board's reconcilers are the canonical process-truth and
 * execution-truth gates. Their contract is "must exit 0". Command reports
 * their verdict, and it does so honestly in three ways that matter:
 *
 *   1. IT NEVER RUNS THEM IMPLICITLY. A gate runs only because the Founder
 *      asked for it. An unrun gate is UNKNOWN, never PASS. A surface that
 *      showed a green gate nobody executed would be inventing truth.
 *
 *   2. IT ONLY EVER RUNS THE READ-ONLY PAIR. The ingester
 *      (`ingest_room_activity.py`) is deliberately NOT runnable from here: it
 *      writes activity.json and activity_state.json into the control board, and
 *      Command is read-only. The run list is a closed allowlist, not a
 *      parameter.
 *
 *   3. A TOOL THAT CANNOT RUN IS NOT A FAILING TRUTH. Both reconcilers are
 *      authored for a POSIX mount. If this host cannot execute them, the
 *      result is UNAVAILABLE with the interpreter's own error attached — never
 *      DRIFT, and never a verdict about the company. The distinction between
 *      "the tool cannot run here" and "the truth has moved" is the entire
 *      value of reporting this honestly.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { CANONICAL, CONTROL_BOARD_FILES, abs } from './paths.mjs';
import { DIMENSION } from './health-floor.mjs';

/**
 * The closed allowlist. Two entries, both read-only, both named here. There is
 * no code path that runs an arbitrary script path supplied by a caller.
 */
export const RUNNABLE_GATES = Object.freeze([
  {
    id: 'gateProcessTruth',
    label: 'Process-truth reconciliation',
    script: CONTROL_BOARD_FILES.gateProcessTruth,
    truth: 'process truth',
  },
  {
    id: 'gateExecutionTruth',
    label: 'Execution-truth reconciliation',
    script: CONTROL_BOARD_FILES.gateExecutionTruth,
    truth: 'execution truth',
  },
]);

/** Scripts Command will never run, with the reason recorded. */
export const REFUSED_SCRIPTS = Object.freeze([
  {
    id: 'ingester',
    script: CONTROL_BOARD_FILES.ingester,
    reason: 'writes activity.json and activity_state.json into the control board; Command is read-only by construction',
  },
]);

function tail(text, lines) {
  if (!text) return [];
  return text.split(/\r?\n/).filter((l) => l.trim()).slice(-lines);
}

function runGate(gate, root, timeoutMs) {
  const relPath = `${CANONICAL.controlBoard}/${gate.script}`;
  const base = { id: gate.id, label: gate.label, truth: gate.truth, path: relPath };

  if (!root) {
    return { ...base, state: DIMENSION.UNAVAILABLE, detail: 'workspace root unresolved', exit_code: null, verdict: null };
  }
  const target = abs(root, relPath);
  if (!RUNNABLE_GATES.some((g) => g.script === gate.script)) {
    return { ...base, state: DIMENSION.UNAVAILABLE, detail: 'script is not on the read-only run allowlist', exit_code: null, verdict: null };
  }

  const python = process.env.COMMAND_PYTHON || 'python3';
  let stdout = '';
  let stderr = '';
  // Start optimistic and let the catch block correct it. Leaving this null
  // would classify a gate that exited cleanly as FAIL, which is precisely the
  // kind of false alarm this product exists to avoid.
  let status = 0;
  let launchError = null;
  try {
    stdout = execFileSync(python, [target], {
      cwd: path.dirname(target),
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (err) {
    // A non-zero exit is a legitimate gate FAIL and arrives here. So does a
    // missing interpreter, which is an environment problem. They must not be
    // reported identically.
    status = typeof err.status === 'number' ? err.status : null;
    stdout = err.stdout ?? '';
    stderr = err.stderr ?? '';
    if (err.code === 'ENOENT' || /not recognized|command not found/i.test(stderr || '')) {
      launchError = `interpreter '${python}' could not be launched on this host`;
    }
  }

  if (launchError) {
    return {
      ...base,
      state: DIMENSION.UNAVAILABLE,
      detail: launchError,
      interpreter: python,
      exit_code: null,
      verdict: null,
      // The tool is blocked. This says nothing about whether the truth is
      // sound, and it is deliberately not reported as a drift.
      truth_impact: 'NOT_ASSESSED — the tool could not run, which is not evidence about the truth',
      stderr_tail: tail(stderr, 8),
    };
  }

  const combined = `${stdout}\n${stderr}`;
  const verdictMatch = combined.match(/VERDICT:\s*([A-Z_]+)/);
  const verdict = verdictMatch ? verdictMatch[1] : null;
  const state = status === 0 ? DIMENSION.OK : DIMENSION.FAIL;

  return {
    ...base,
    state,
    detail:
      status === 0
        ? `exited 0 — ${verdict ?? 'no VERDICT line found in output'}`
        : `exited ${status ?? 'non-zero'} — ${verdict ?? 'no VERDICT line found in output'}`,
    interpreter: python,
    exit_code: status,
    verdict,
    stdout_tail: tail(stdout, 24),
    stderr_tail: tail(stderr, 8),
    ran_at: new Date().toISOString(),
    read_only: true,
  };
}

/**
 * Run the read-only gate pair and report each verdict separately.
 *
 * There is deliberately no single "gates green" boolean in the return value.
 * The caller decides how to present it, and the per-gate states are what the
 * Founder is entitled to read.
 */
export function runReadOnlyGates({ root, timeoutMs = 20000 }) {
  const results = RUNNABLE_GATES.map((g) => runGate(g, root, timeoutMs));
  const blocked = results.filter((r) => r.state === DIMENSION.UNAVAILABLE);
  const failing = results.filter((r) => r.state === DIMENSION.FAIL);

  const state = blocked.length
    ? DIMENSION.UNAVAILABLE
    : failing.length
      ? DIMENSION.FAIL
      : results.length
        ? DIMENSION.OK
        : DIMENSION.UNKNOWN;

  return {
    state,
    ran_at: new Date().toISOString(),
    detail: blocked.length
      ? `${blocked.length}/${results.length} gate(s) could not be executed on this host — that is an environment finding, not a verdict about the truth`
      : failing.length
        ? `${failing.length}/${results.length} gate(s) exited non-zero`
        : `${results.length}/${results.length} read-only gate(s) exited 0`,
    gates: results,
    refused: REFUSED_SCRIPTS,
    run_policy: 'Read-only allowlist only. The ingester writes to the control board and is never executed from Command.',
  };
}
