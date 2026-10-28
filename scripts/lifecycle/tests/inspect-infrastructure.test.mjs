import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { classifyInfrastructureProcess, inspectDeclaredInfrastructure, osVerdict } from '../inspect.mjs';
import { resolveExternalComponent } from '../../../server/external-components.mjs';

const HERDR = 'C:\\Users\\Ali Musthaq\\.herdr\\packages\\standalone\\releases\\0.9.5-x86_64-pc-windows-msvc\\herdr.exe';
const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const SCRIPTS = resolveExternalComponent('agent-comms').root
  ? path.join(resolveExternalComponent('agent-comms').root, 'scripts')
  : path.join(process.cwd(), 'agent-comms', 'scripts');
const PINS = { herdrExecutable: HERDR, scriptsRoot: SCRIPTS };

test('declared infrastructure is classified by node.exe and resolved script path, never by pid or substring', () => {
  assert.equal(classifyInfrastructureProcess({ exe: HERDR }, PINS).id, 'standalone-herdr');
  assert.equal(classifyInfrastructureProcess({
    exe: NODE,
    cmd: `"${NODE}" "${SCRIPTS}\\room-watch-codex.mjs" `,
  }, PINS).id, 'room-watcher');
  assert.equal(classifyInfrastructureProcess({
    exe: NODE,
    cmd: `"${NODE}" ${SCRIPTS}\\starq-bot-gateway.mjs`,
  }, PINS).id, 'starqbot-gateway');
  assert.equal(classifyInfrastructureProcess({
    exe: 'C:\\Windows\\System32\\cmd.exe',
    cmd: `C:\\Windows\\System32\\cmd.exe /c ${SCRIPTS}\\run-persistent-starq-bot.cmd`,
  }, PINS).id, 'starqbot-gateway');
  assert.equal(classifyInfrastructureProcess({
    exe: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    cmd: `powershell -File keep-room-watch-codex.ps1 ${SCRIPTS}\\room-watch-codex.mjs`,
  }, PINS).kind, 'NOT_CLASSIFIED');
  assert.equal(classifyInfrastructureProcess({
    exe: NODE,
    cmd: `"${NODE}" -e "console.log('room-watch-codex.mjs')"`,
  }, PINS).kind, 'NOT_CLASSIFIED');
  assert.equal(classifyInfrastructureProcess({
    exe: NODE,
    cmd: `"${NODE}" ${SCRIPTS}\\run-persistent-starq-bot.cmd`,
  }, PINS).kind, 'NOT_CLASSIFIED');
  assert.equal(classifyInfrastructureProcess({ exe: 'C:\\Windows\\System32\\notepad.exe', cmd: 'notepad' }, PINS).kind, 'NOT_CLASSIFIED');
});

test('unrelated entrypoint stays unclassified when the infrastructure path is only a later argument', () => {
  assert.equal(classifyInfrastructureProcess({
    exe: NODE,
    cmd: `"${NODE}" D:\\other\\unrelated.mjs "${SCRIPTS}\\room-watch-codex.mjs"`,
  }, PINS).kind, 'NOT_CLASSIFIED');
  assert.equal(classifyInfrastructureProcess({
    exe: NODE,
    cmd: `"${NODE}" --require "${SCRIPTS}\\starq-bot-gateway.mjs" D:\\other\\unrelated.mjs`,
  }, PINS).kind, 'NOT_CLASSIFIED');
  assert.equal(classifyInfrastructureProcess({
    exe: 'C:\\Windows\\System32\\cmd.exe',
    cmd: `C:\\Windows\\System32\\cmd.exe /c D:\\other\\unrelated.cmd ${SCRIPTS}\\run-persistent-starq-bot.cmd`,
  }, PINS).kind, 'NOT_CLASSIFIED');
});

test('osVerdict still treats pid-reuse as FOREIGN; classification does not override it', () => {
  const child = { exe: process.execPath, created_at: '2020-01-01T00:00:00.000Z' };
  const info = { found: true, exe: process.execPath, created: '2021-01-01T00:00:00.000Z' };
  assert.equal(osVerdict(child, info, process.execPath).verdict, 'FOREIGN');
});

test('inspectDeclaredInfrastructure parses a live-shaped process list without signalling', async () => {
  const rows = await inspectDeclaredInfrastructure({ herdrExecutable: HERDR, scriptsRoot: SCRIPTS }, {
    execFileImpl: (exe, args, opts, cb) => {
      assert.equal(opts.env.STARQ_LC_HERDR, HERDR);
      assert.equal(opts.env.STARQ_LC_SCRIPTS, SCRIPTS);
      cb(null, JSON.stringify([{ pid: 12, found: true, name: 'herdr.exe', exe: HERDR, cmd: HERDR }]), '');
    },
  });
  assert.equal(rows[0].pid, 12);
});
