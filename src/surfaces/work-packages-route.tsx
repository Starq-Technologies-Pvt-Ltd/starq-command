/** Read-only binding from the Command data service to the existing Work UI. */
import * as React from 'react';
import type { WorkPackageRow } from '@/lib/contracts';
import { WorkPackagesSurface } from '@/surfaces/work-packages';

function isWorkPackageRows(value: unknown): value is WorkPackageRow[] {
  if (!Array.isArray(value)) return false;
  return value.every((row) => {
    if (!row || typeof row !== 'object') return false;
    const item = row as Record<string, unknown>;
    const source = item.source as Record<string, unknown> | null;
    return (
      typeof item.id === 'string' &&
      typeof item.project_id === 'string' &&
      typeof item.title === 'string' &&
      (typeof item.current_stage === 'string' || item.current_stage === null) &&
      (typeof item.owner === 'string' || item.owner === null) &&
      (typeof item.verifier === 'string' || item.verifier === null) &&
      (typeof item.board_lane === 'string' || item.board_lane === null) &&
      !!source &&
      (source.kind === 'ERP_TASK' || source.kind === 'HOADHA_ITEM' || source.kind === 'GENERAL_ASSIGNMENT') &&
      typeof source.reference === 'string'
    );
  });
}

export function WorkPackagesRoute() {
  const [rows, setRows] = React.useState<WorkPackageRow[] | null>(null);

  React.useEffect(() => {
    let mounted = true;
    let reading = false;
    const refresh = () => {
      if (reading) return;
      reading = true;
      void fetch('/api/work-packages', { cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) throw new Error(`work package feed returned ${response.status}`);
          const value: unknown = await response.json();
          if (value !== null && !isWorkPackageRows(value)) throw new Error('work package feed contract invalid');
          // Preserve the supplied rows verbatim; null remains UNKNOWN.
          if (mounted) setRows(value);
        })
        .catch(() => {
          // A failed or malformed response is not a verified empty list.
          if (mounted) setRows(null);
        })
        .finally(() => { reading = false; });
    };

    // Match the existing Command surface cadence. Polling only reads the
    // authorized feed; it does not ingest, regenerate, or write source data.
    refresh();
    const timer = window.setInterval(refresh, 15000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  return <WorkPackagesSurface rows={rows} />;
}
