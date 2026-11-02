/**
 * Which processes still "name this workspace" after a stop, EXCLUDING only the
 * acceptance run itself.
 *
 * Review finding (PR #19, Room #17430): the scan matched on command line, and the
 * acceptance runner (`node ... --ws <dir>`) and the shell that invoked it carry
 * the workspace in THEIR command lines too, so every stop check reported them as
 * survivors (61/64). That is a false positive, but the cure is not a name
 * exclusion: ignoring every node.exe or pwsh.exe would hide a surviving Command
 * child, which IS a node.exe. The runner is excluded by IDENTITY - its own pid
 * and the chain of processes that started it - plus the scan's own probe. Any
 * other process naming the workspace, whatever its image name, is a stray.
 */
export function ancestorsOf(pid, table) {
  const parentOf = new Map(table.map((p) => [p.pid, p.ppid]));
  const chain = [];
  const seen = new Set([pid]);
  let next = parentOf.get(pid);
  while (Number.isInteger(next) && next > 0 && !seen.has(next)) {
    chain.push(next);
    seen.add(next);
    next = parentOf.get(next);
  }
  return chain;
}

/**
 * @param table     every process: { pid, ppid, name, cmd }
 * @param workspace the disposable workspace path
 * @param harnessPid the acceptance runner's own pid
 * @param probePid   the pid of the scan itself (it carries the workspace in its script)
 */
export function selectStrays(table, { workspace, harnessPid, probePid = null }) {
  const needle = String(workspace).toLowerCase();
  const exempt = new Set([harnessPid, probePid, ...ancestorsOf(harnessPid, table)].filter((p) => Number.isInteger(p)));
  return table
    .filter((p) => typeof p.cmd === 'string' && p.cmd.toLowerCase().includes(needle) && !exempt.has(p.pid))
    .map((p) => ({ pid: p.pid, name: p.name }));
}
