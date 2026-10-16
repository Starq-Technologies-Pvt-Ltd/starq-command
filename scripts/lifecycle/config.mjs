/**
 * Canonical lifecycle configuration: load, validate, and reject runtime overrides.
 *
 * lifecycle.config.json is the ONLY source of component names, ports, health
 * contracts and dependency order. The PowerShell commands read the same file.
 * Environment variables that used to override ports are refused outright, so
 * there is never a second, divergent port truth.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const CONFIG_SCHEMA = 'starq.command.lifecycle.config/v1';
export const REQUIRED_COMPONENTS = Object.freeze(['data', 'building', 'herdrBroker', 'herdr', 'ui']);
export const OBSERVATION_PROFILE = 'command-observation-only/v1';
export const OBSERVATION_COMPONENTS = Object.freeze(['data', 'building', 'ui']);
const OBSERVATION_COMPONENT_PINS = Object.freeze({
  data: {
    port: 5177, kind: 'module', entry: '00_STARQ_HQ\\operations\\starq-command\\server\\data-service.mjs', cwd: '00_STARQ_HQ\\operations\\starq-command',
    health: { path: '/api/health', status: 200, content_type: 'application/json', json_equals: { 'health.overall': 'OK' }, json_has: ['assembled_at', 'workspace', 'health'] },
  },
  building: {
    port: 5178, kind: 'module', entry: '00_STARQ_HQ\\operations\\starq-command\\server\\building-service.mjs', cwd: '00_STARQ_HQ\\operations\\starq-command',
    health: { path: '/api/building/health', status: 200, content_type: 'application/json', json_has: ['generated_at', 'origin', 'integrity'] },
  },
  ui: {
    port: 5173, kind: 'vite', entry: '00_STARQ_HQ\\operations\\starq-command\\node_modules\\vite\\dist\\node\\index.js', cwd: '00_STARQ_HQ\\operations\\starq-command\\observation', vite_config: '00_STARQ_HQ\\operations\\starq-command\\observation\\vite.config.ts',
    health: { path: '/', status: 200, content_type: 'text/html', body_includes: ['STARQ // COMMAND · OBSERVATION ONLY', '<div id="root"></div>'] },
  },
});
export const OBSERVATION_SYSTEM_ROOT = 'C:\\Windows';
export const OBSERVATION_INSPECTION_TOOLS = Object.freeze({
  powershell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  netstat: 'C:\\Windows\\System32\\netstat.exe',
});
export const OBSERVATION_RUNTIME_DIRECTORY = '00_STARQ_HQ\\operations\\starq-command\\.command-runtime-observation';
export const OBSERVATION_SHARED_LOCK = '00_STARQ_HQ\\operations\\starq-command\\.command-runtime\\lifecycle.lock';
export const OBSERVATION_REQUIRED_FILES = Object.freeze([
  '00_STARQ_HQ\\operations\\starq-command\\Start-Command-Observation.bat',
  '00_STARQ_HQ\\operations\\starq-command\\scripts\\observation-start.ps1',
  '00_STARQ_HQ\\operations\\starq-command\\scripts\\command-lifecycle.mjs',
  '00_STARQ_HQ\\operations\\starq-command\\scripts\\lifecycle\\owner.mjs',
  '00_STARQ_HQ\\operations\\starq-command\\scripts\\lifecycle\\config.mjs',
  '00_STARQ_HQ\\operations\\starq-command\\scripts\\lifecycle\\gates.mjs',
  '00_STARQ_HQ\\operations\\starq-command\\scripts\\lifecycle\\inspect.mjs',
  '00_STARQ_HQ\\operations\\starq-command\\scripts\\lifecycle\\lock.mjs',
  '00_STARQ_HQ\\operations\\starq-command\\scripts\\lifecycle-child.mjs',
  '00_STARQ_HQ\\operations\\starq-command\\server\\data-service.mjs',
  '00_STARQ_HQ\\operations\\starq-command\\server\\building-service.mjs',
  '00_STARQ_HQ\\operations\\starq-command\\observation\\ObservationApp.tsx',
  '00_STARQ_HQ\\operations\\starq-command\\observation\\http-boundary.mjs',
  '00_STARQ_HQ\\operations\\starq-command\\observation\\vite.config.ts',
  '00_STARQ_HQ\\operations\\starq-lifecycle\\runtime-policy.mjs',
  '00_STARQ_HQ\\operations\\herdr-floor\\src\\rule0.mjs',
  '00_STARQ_HQ\\operations\\herdr-floor\\src\\launcher.mjs',
  '00_STARQ_HQ\\operations\\herdr-floor\\src\\windows-containment.mjs',
  '00_STARQ_HQ\\operations\\herdr-floor\\src\\containment-config.mjs',
]);

const OBSERVATION_ENV_BLOCKLIST = new Set([
  'NODE_OPTIONS', 'NODE_PATH', 'NODE_REPL_EXTERNAL_MODULE', 'NODE_USE_ENV_PROXY',
  'NODE_EXTRA_CA_CERTS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_PRESERVE_SYMLINKS',
  'NODE_PRESERVE_SYMLINKS_MAIN', 'HOST', 'PORT', 'COMMAND_HOST',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
]);

/** Every env var a component reads for a port/URL. Set in the OWNER's env = refusal. */
export const OVERRIDE_ENV = Object.freeze([
  'COMMAND_PORT', 'BUILDING_SERVICE_PORT', 'HERDR_FLOOR_PORT', 'HERDR_SERVICE_PORT', 'COMMAND_UI_PORT',
  'HERDR_FLOOR_URL', 'COMMAND_DATA_SERVICE', 'BUILDING_SERVICE', 'HERDR_SERVICE', 'COMMAND_UI_ORIGIN',
]);

/** Runtime binaries pinned by config. Set in the OWNER's env = refusal (a second binary truth). */
export const RUNTIME_PIN_ENV = Object.freeze(['HERDR_BIN']);

/**
 * Standalone Herdr is required by the normal profile but OWNED ELSEWHERE: the
 * Founder opens and closes it interactively. Command never starts or stops it;
 * it only observes it read-only through this one pinned binary.
 */
export const STANDALONE_HERDR_ID = 'standalone-herdr';
export const STANDALONE_HERDR_PROTOCOL = Object.freeze({ owner_protocol: 'OPERATOR_INTERACTIVE', command_actuation: 'NONE' });

/** The broker's Origin allowlist is pinned to this UI port (herdr-floor DEFAULT_ALLOWED_ORIGINS). */
export const PINNED_UI_PORT = 5173;

export class ConfigError extends Error {
  constructor(problems) {
    super(`lifecycle config invalid:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * @param {string} file
 * @param {{checkFiles?: boolean}} opts  checkFiles=false is for offline tests on fixture paths
 */
export function loadConfig(file, { checkFiles = true } = {}) {
  let raw;
  try { raw = readFileSync(file); } catch (err) { throw new ConfigError([`cannot read ${file}: ${err.message}`]); }
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) throw new ConfigError([`${file} has a UTF-8 BOM; it must be BOM-free`]);
  let doc;
  try { doc = JSON.parse(raw.toString('utf8')); } catch (err) { throw new ConfigError([`${file} is not valid JSON: ${err.message}`]); }
  const problems = validateConfig(doc, { checkFiles });
  if (problems.length) throw new ConfigError(problems);
  const sha256 = createHash('sha256').update(raw).digest('hex');
  return Object.freeze({ ...doc, file, sha256, abs: (rel) => path.join(doc.workspace_root, rel) });
}

export function validateConfig(doc, { checkFiles = true } = {}) {
  const p = [];
  if (!doc || typeof doc !== 'object') return ['config is not an object'];
  if (doc.schema !== CONFIG_SCHEMA) p.push(`schema must be ${CONFIG_SCHEMA}`);
  const observationOnly = doc.profile?.name === OBSERVATION_PROFILE;
  if (typeof doc.workspace_root !== 'string' || !path.isAbsolute(doc.workspace_root)) p.push('workspace_root must be an absolute path');
  if (typeof doc.node !== 'string' || !path.isAbsolute(doc.node)) p.push('node must be an absolute path');
  if (doc.host !== '127.0.0.1') p.push('host must be 127.0.0.1');
  for (const k of ['identity', 'health', 'graceful_exit', 'broker_request', 'agent_stop']) {
    if (!Number.isInteger(doc.timeouts_ms?.[k]) || doc.timeouts_ms[k] <= 0) p.push(`timeouts_ms.${k} must be a positive integer`);
  }
  const comps = Array.isArray(doc.components) ? doc.components : [];
  const names = comps.map((c) => c?.name);
  const required = observationOnly ? OBSERVATION_COMPONENTS : REQUIRED_COMPONENTS;
  for (const req of required) if (!names.includes(req)) p.push(`component '${req}' is missing (incomplete component set)`);
  for (const n of names) if (!required.includes(n)) p.push(`unknown component '${n}'`);
  if (observationOnly) {
    const profile = doc.profile;
    if (JSON.stringify(names) !== JSON.stringify(OBSERVATION_COMPONENTS)) p.push(`observation profile components must be exactly ${OBSERVATION_COMPONENTS.join(', ')} in that order`);
    for (const flag of ['observation_only', 'worker_admission', 'room_event_adapter', 'process_control', 'agent_launch']) {
      const expected = flag === 'observation_only';
      if (profile?.[flag] !== expected) p.push(`observation profile ${flag} must be ${expected}`);
    }
    if (profile?.external_required !== undefined && (!Array.isArray(profile.external_required) || profile.external_required.length)) p.push('observation profile cannot declare external runtime requirements');
    if (profile?.communications !== undefined && (!Array.isArray(profile.communications) || profile.communications.length)) p.push('observation profile cannot declare communication adapters');
    if (JSON.stringify(profile?.required_components) !== JSON.stringify(OBSERVATION_COMPONENTS)) p.push('observation profile required_components must match its exact service set');
    if (JSON.stringify(profile?.required_files) !== JSON.stringify(OBSERVATION_REQUIRED_FILES)) p.push('observation profile required_files must match its scoped runtime source set');
    if (profile?.runtime_directory !== OBSERVATION_RUNTIME_DIRECTORY) p.push(`observation profile runtime_directory must be ${OBSERVATION_RUNTIME_DIRECTORY}`);
    if (profile?.shared_lock_file !== OBSERVATION_SHARED_LOCK) p.push(`observation profile shared_lock_file must be ${OBSERVATION_SHARED_LOCK}`);
    if (doc.system_root !== OBSERVATION_SYSTEM_ROOT) p.push(`observation profile system_root must be ${OBSERVATION_SYSTEM_ROOT}`);
    for (const [key, expected] of Object.entries(OBSERVATION_INSPECTION_TOOLS)) {
      if (doc.inspection_tools?.[key] !== expected) p.push(`observation profile inspection_tools.${key} must be ${expected}`);
    }
    for (const c of comps) {
      const pin = OBSERVATION_COMPONENT_PINS[c?.name];
      if (!pin) continue;
      for (const [key, expected] of Object.entries(pin)) {
        if (JSON.stringify(c[key]) !== JSON.stringify(expected)) p.push(`observation profile ${c.name}.${key} must match its pinned value`);
      }
      const expectedDeps = c.name === 'ui' ? ['data', 'building'] : [];
      if (JSON.stringify(c.depends_on) !== JSON.stringify(expectedDeps)) p.push(`observation profile ${c.name}.depends_on must be ${JSON.stringify(expectedDeps)}`);
    }
    if (comps.find((c) => c?.name === 'ui')?.health?.body_includes?.includes('STARQ // COMMAND · OBSERVATION ONLY') !== true) p.push('observation profile UI health must assert the observation-only marker');
  }
  if (new Set(names).size !== names.length) p.push('component names must be unique');
  const ports = comps.map((c) => c?.port);
  if (new Set(ports).size !== ports.length) p.push('component ports must be unique');
  for (const c of comps) {
    if (!c || typeof c !== 'object') { p.push('component entry is not an object'); continue; }
    if (!Number.isInteger(c.port) || c.port < 1024 || c.port > 65535) p.push(`${c.name}: port must be an integer in 1024..65535`);
    if (!['module', 'vite'].includes(c.kind)) p.push(`${c.name}: kind must be module or vite`);
    if (typeof c.entry !== 'string' || path.isAbsolute(c.entry)) p.push(`${c.name}: entry must be workspace-relative`);
    if (typeof c.cwd !== 'string' || path.isAbsolute(c.cwd)) p.push(`${c.name}: cwd must be workspace-relative`);
    if (!Array.isArray(c.depends_on)) p.push(`${c.name}: depends_on must be an array`);
    else for (const d of c.depends_on) if (!names.includes(d)) p.push(`${c.name}: depends on unknown '${d}'`);
    const h = c.health;
    if (!h || typeof h.path !== 'string' || !h.path.startsWith('/') || !Number.isInteger(h.status)) p.push(`${c.name}: health needs path and status`);
    else if (!h.json_has && !h.json_equals && !h.body_includes) p.push(`${c.name}: health must assert response content, not just a status`);
    if (c.kind === 'vite' && typeof c.vite_config !== 'string') p.push(`${c.name}: vite_config required`);
    if (c.name === 'herdrBroker' && (typeof c.lifecycle_token !== 'string' || typeof c.manifest !== 'string')) p.push('herdrBroker: lifecycle_token and manifest required');
  }
  const ui = comps.find((c) => c?.name === 'ui');
  if (ui && ui.port !== PINNED_UI_PORT) p.push(`ui port must be ${PINNED_UI_PORT}: the broker Origin allowlist is pinned to it`);
  if (doc.profile?.external_required !== undefined) {
    const ext = doc.profile.external_required;
    if (!Array.isArray(ext)) p.push('profile.external_required must be an array');
    else {
      const sh = ext.filter((e) => e?.id === STANDALONE_HERDR_ID);
      if (sh.length > 1) p.push(`profile: ${STANDALONE_HERDR_ID} declared more than once`);
      for (const e of sh) {
        if (typeof e.executable !== 'string' || !path.isAbsolute(e.executable)) p.push(`${STANDALONE_HERDR_ID}: executable must be an absolute path`);
        if (typeof e.storage_root !== 'string' || !path.isAbsolute(e.storage_root)) p.push(`${STANDALONE_HERDR_ID}: storage_root must be an absolute path`);
        if (typeof e.owner_record !== 'string' || path.isAbsolute(e.owner_record)) p.push(`${STANDALONE_HERDR_ID}: owner_record must be workspace-relative`);
        for (const [k, v] of Object.entries(STANDALONE_HERDR_PROTOCOL)) if (e[k] !== v) p.push(`${STANDALONE_HERDR_ID}: ${k} must be ${v}; Command is never a second owner`);
      }
    }
  }
  if (!p.length) {
    try { topoOrder(comps); } catch (err) { p.push(err.message); }
  }
  if (checkFiles && !p.length) {
    if (!existsSync(doc.node)) p.push(`node runtime missing: ${doc.node}`);
    for (const c of comps) {
      for (const rel of [c.entry, c.cwd, c.vite_config, c.manifest].filter(Boolean)) {
        if (!existsSync(path.join(doc.workspace_root, rel))) p.push(`${c.name}: missing ${rel}`);
      }
    }
    for (const rel of doc.profile?.required_files ?? []) {
      if (!existsSync(path.join(doc.workspace_root, rel))) p.push(`profile: required file missing ${rel}`);
    }
  }
  return p;
}

/** Dependency order, stable by declaration order. Throws on a cycle. */
export function topoOrder(components) {
  const byName = new Map(components.map((c) => [c.name, c]));
  const out = [];
  const state = new Map();
  const visit = (c, trail) => {
    if (state.get(c.name) === 'done') return;
    if (state.get(c.name) === 'visiting') throw new Error(`dependency cycle: ${[...trail, c.name].join(' -> ')}`);
    state.set(c.name, 'visiting');
    for (const d of c.depends_on) visit(byName.get(d), [...trail, c.name]);
    state.set(c.name, 'done');
    out.push(c);
  };
  for (const c of components) visit(c, []);
  return out;
}

/** Refuse ANY override in the owner's environment (even an equal value). */
export function findEnvOverrides(env = process.env, cfg = null) {
  const found = [...OVERRIDE_ENV, ...RUNTIME_PIN_ENV].filter((k) => env[k] !== undefined && env[k] !== '').map((k) => `${k}=${env[k]}`);
  if (cfg && env.STARQ_WORKSPACE && path.resolve(env.STARQ_WORKSPACE).toLowerCase() !== path.resolve(cfg.workspace_root).toLowerCase()) {
    found.push(`STARQ_WORKSPACE=${env.STARQ_WORKSPACE} (config says ${cfg.workspace_root})`);
  }
  return found;
}

/** Environment keys that can redirect observer listeners, module loading, or proxy traffic. */
export function findObservationEnvHazards(env = process.env) {
  return Object.entries(env)
    .filter(([key, value]) => value !== undefined && value !== '' && (
      OBSERVATION_ENV_BLOCKLIST.has(key.toUpperCase()) || key.toUpperCase().startsWith('VITE_')
    ))
    .map(([key]) => `${key}=<set>`);
}

/** The single declared standalone Herdr entry, or null when the config declares none. */
export function standaloneHerdr(cfg) {
  return (cfg?.profile?.external_required ?? []).find((e) => e?.id === STANDALONE_HERDR_ID) ?? null;
}

export function portOf(cfg, name) {
  return cfg.components.find((c) => c.name === name).port;
}

/**
 * The environment each component receives. Port values come only from config;
 * the mapping of component -> variable names is fixed here.
 */
export function componentEnv(cfg, name) {
  const u = (n) => `http://${cfg.host}:${portOf(cfg, n)}`;
  const observationOnly = cfg.profile?.name === OBSERVATION_PROFILE;
  switch (name) {
    case 'data': return {
      COMMAND_PORT: String(portOf(cfg, 'data')),
      ...(observationOnly ? { COMMAND_HOST: '127.0.0.1', COMMAND_OBSERVATION_ONLY: '1' } : {}),
    };
    case 'building': return { BUILDING_SERVICE_PORT: String(portOf(cfg, 'building')), ...(observationOnly ? { COMMAND_OBSERVATION_ONLY: '1' } : {}) };
    case 'herdrBroker': {
      // The broker's read-only `herdr status` probe runs the pinned standalone binary, never PATH.
      const sh = standaloneHerdr(cfg);
      return { HERDR_FLOOR_PORT: String(portOf(cfg, 'herdrBroker')), COMMAND_UI_ORIGIN: u('ui'), ...(sh ? { HERDR_BIN: sh.executable } : {}) };
    }
    case 'herdr': return {
      HERDR_SERVICE_PORT: String(portOf(cfg, 'herdr')), HERDR_FLOOR_PORT: String(portOf(cfg, 'herdrBroker')),
      HERDR_FLOOR_URL: u('herdrBroker'), COMMAND_UI_ORIGIN: u('ui'),
    };
    case 'ui': return {
      COMMAND_DATA_SERVICE: u('data'), BUILDING_SERVICE: u('building'),
      ...(observationOnly ? { COMMAND_OBSERVATION_ONLY: '1' } : { HERDR_SERVICE: u('herdr') }),
    };
    default: throw new Error(`no environment mapping for ${name}`);
  }
}
