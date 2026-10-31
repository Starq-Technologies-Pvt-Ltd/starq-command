import { defineConfig } from 'vitest/config';
import path from 'node:path';
// @ts-expect-error — JS module, and tests are outside tsconfig's `include`.
import { resolveWorkspace } from './server/paths.mjs';

// Suites that read canonical sources outside this repository resolve them
// through `@workspace`, not by counting `../` levels. Counting levels tied the
// whole suite to one absolute checkout path, so it could not run in a worktree,
// a fresh clone or CI — see tests/support/workspace.ts.
const workspace = resolveWorkspace();

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
      ...(workspace.root ? { '@workspace': workspace.root } : {}),
    },
  },
  test: {
    environment: 'node',
    // `.tsx` is included so the Phase 2 floor is proven to actually RENDER,
    // not merely to typecheck. A component that throws on mount is the failure
    // mode a type system cannot catch.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    reporters: ['verbose'],
  },
});
