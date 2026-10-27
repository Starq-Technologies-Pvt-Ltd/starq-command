import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  NEXUS_COMPANY_BOARD_ROOT,
  NEXUS_TASK_SOURCES,
  readBuildingSource,
} from '../server/building.mjs';

describe('Nexus-to-Command board continuity', () => {
  it('uses the dedicated company-board root when Command has no local Nexus checkout', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'command-nexus-bridge-'));
    try {
      const source = readBuildingSource(root, 'starqNexus/data/starq-erp-tasks.json');
      expect(source.state).toBe('AVAILABLE');
      expect(source.source_kind).toBe('NEXUS_COMPANY_BOARD');
      expect(source.source_root).toBe(fs.realpathSync(NEXUS_COMPANY_BOARD_ROOT));
      expect(source.data.tasks).toHaveLength(437);
      expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps the bridge closed to anything except its four declared task files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'command-nexus-bridge-'));
    try {
      const unexpected = readBuildingSource(root, 'starqNexus/data/unrelated.json');
      expect(unexpected.state).toBe('UNREADABLE');
      expect(unexpected.data).toBeNull();
      expect(NEXUS_TASK_SOURCES).toHaveLength(4);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
