import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { importExternalComponent, resolveExternalComponent } from '../server/external-components.mjs';
import { resolveWorkspace } from '../server/paths.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const testsRoot = path.join(root, 'lifecycle', 'tests');
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (!Number.isInteger(nodeMajor) || nodeMajor < 20) {
  throw new Error(`Lifecycle tests require Node.js >=20; found ${process.version} at ${process.execPath}`);
}
const needs = new Map([
  ['development-readiness.test.mjs', {
    components: ['starq-lifecycle', 'herdr-floor'], platform: 'win32', workspace: true,
    componentFiles: {
      'starq-lifecycle': ['runtime-policy.mjs', 'native/JobGuardian.exe', 'native/guardian-build.json', 'Start-Starq.ps1'],
      'herdr-floor': ['src/containment-config.mjs', 'src/rule0.mjs'],
    },
    componentModules: {
      'starq-lifecycle': { 'runtime-policy.mjs': ['checkDevelopmentRule0', 'developmentOperationalSpecs'] },
      'herdr-floor': { 'src/containment-config.mjs': ['compatibilityGate', 'developmentContainmentGate', 'probeDevelopmentRuntimeContainment', 'containmentOptions', 'containmentDependencyPaths'] },
    },
    workspaceFiles: ['STARQ.md', 'Start-Starq.bat', '00_STARQ_HQ/operations/starq-command/lifecycle.config.json'],
    pinnedNode: true,
  }],
  ['historical-closeout-handoff.test.mjs', {
    components: ['herdr-floor'], componentFiles: {
      'herdr-floor': ['src/historical-closeout-exception.mjs', 'state/historical-closeout-exception-20261027.json', 'state/registry.pre-option-b-15821.json'],
    },
    componentModules: { 'herdr-floor': { 'src/historical-closeout-exception.mjs': ['HISTORICAL_CLOSEOUT_EXCEPTION'] } },
  }],
  ['native-fixtures-static.test.mjs', {
    components: ['starq-lifecycle', 'herdr-floor'], componentFiles: {
      'starq-lifecycle': ['native-fixtures/oracles.mjs', 'native-fixtures/harness.mjs', 'native-fixtures/fixtures/child.mjs', 'native-fixtures/fixtures/parent.mjs', 'native-fixtures/fixtures/breakaway.cs'],
      'herdr-floor': ['src/containment-config.mjs'],
    },
    componentModules: {
      'starq-lifecycle': { 'native-fixtures/oracles.mjs': ['judge'] },
      'herdr-floor': { 'src/containment-config.mjs': ['REQUIRED_CASES'] },
    },
  }],
  ['observation-profile.test.mjs', {
    components: ['starq-lifecycle', 'herdr-floor'], componentFiles: {
      'starq-lifecycle': ['runtime-policy.mjs'], 'herdr-floor': ['src/rule0.mjs'],
    },
    componentModules: {
      'starq-lifecycle': { 'runtime-policy.mjs': ['observationRuntimeSpecs'] },
      'herdr-floor': { 'src/rule0.mjs': ['inventoryPaths'] },
    },
  }],
  ['standalone-herdr.test.mjs', {
    components: ['starq-lifecycle'], componentFiles: { 'starq-lifecycle': ['runtime-policy.mjs'] },
    componentModules: { 'starq-lifecycle': { 'runtime-policy.mjs': ['runtimeSpecs'] } },
  }],
]);
const workspace = resolveWorkspace();
const componentRoots = new Map();
for (const name of ['starq-lifecycle', 'herdr-floor']) {
  componentRoots.set(name, resolveExternalComponent(name, { workspaceRoot: workspace.root }).root);
}
console.log(`Lifecycle preflight: Node ${process.version} (${process.execPath}); OS ${process.platform}; canonical workspace ${workspace.root ?? `UNAVAILABLE (${workspace.source})`}.`);
const files = (await readdir(testsRoot)).filter((name) => name.endsWith('.test.mjs')).sort();
const selected = [];
let skipped = 0;
for (const name of files) {
  const requirement = needs.get(name);
  const reasons = [];
  if (requirement) {
    for (const component of requirement.components ?? []) {
      const resolved = resolveExternalComponent(component, { workspaceRoot: workspace.root });
      if (resolved.state !== 'AVAILABLE') reasons.push(`${component}: ${resolved.reason}`);
    }
    for (const [component, paths] of Object.entries(requirement.componentFiles ?? {})) {
      const componentRoot = componentRoots.get(component);
      for (const file of paths) if (!componentRoot || !existsSync(path.join(componentRoot, file))) reasons.push(`${component}/${file}: required runtime/fixture file unavailable`);
    }
    for (const [component, modules] of Object.entries(requirement.componentModules ?? {})) {
      for (const [relativeModule, expectedExports] of Object.entries(modules)) {
        const imported = await importExternalComponent(component, relativeModule, { workspaceRoot: workspace.root });
        if (imported.state !== 'AVAILABLE') {
          reasons.push(`${component}/${relativeModule}: incompatible or unavailable (${imported.reason})`);
        } else {
          const missingExports = expectedExports.filter((name) => !(name in imported.module));
          if (missingExports.length) reasons.push(`${component}/${relativeModule}: incompatible companion exports (${missingExports.join(', ')})`);
        }
      }
    }
    if (requirement.workspace && !workspace.root) reasons.push(`canonical workspace: ${workspace.source}`);
    for (const file of requirement.workspaceFiles ?? []) {
      if (!workspace.root || !existsSync(path.join(workspace.root, file))) reasons.push(`workspace/${file}: required canonical input unavailable`);
    }
    if (requirement.platform && process.platform !== requirement.platform) reasons.push(`OS: requires ${requirement.platform}, found ${process.platform}`);
    if (requirement.pinnedNode) {
      let pinnedNode;
      try {
        const configPath = path.resolve(root, '..', 'lifecycle.config.json');
        pinnedNode = JSON.parse(readFileSync(configPath, 'utf8')).node;
      } catch (error) {
        reasons.push(`pinned Node config: unreadable (${error.message})`);
      }
      if (!pinnedNode || !existsSync(pinnedNode)) reasons.push(`pinned Windows Node runtime: ${pinnedNode ?? 'not configured'} is unavailable`);
      if (!existsSync(process.execPath) || path.basename(process.execPath).toLowerCase() !== 'node.exe') reasons.push(`test Node runtime: expected a resolvable node.exe, found ${process.execPath}`);
    }
  }
  if (reasons.length) {
    skipped += 1;
    console.log(`SKIP ${name}: ${reasons.join('; ')}`);
  } else {
    console.log(`RUN ${name}${requirement ? ' (declared prerequisites available)' : ' (self-contained)'}`);
    selected.push(path.join(testsRoot, name));
  }
}
console.log(`Lifecycle suite: ${selected.length} runnable, ${skipped} prerequisite-dependent suite(s) skipped; skips are not passes.`);
if (!selected.length) {
  console.error('No lifecycle tests ran; all suites were blocked by unmet prerequisites. This is not a passing test result.');
  process.exit(2);
}
const result = spawnSync(process.execPath, ['--test', ...selected], { cwd: path.resolve(root, '..'), env: process.env, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
