import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
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
