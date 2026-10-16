import * as React from 'react';
import { cn } from '@/lib/utils';

const Progress = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { value: number | null | undefined }
>(({ className, value, ...props }, ref) => {
  const pct = value === null || value === undefined || Number.isNaN(value) ? null : Math.min(100, Math.max(0, value * 100));
  return (
    <div
      ref={ref}
      role="progressbar"
      aria-valuenow={pct ?? undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={pct === null ? 'UNKNOWN' : `${pct.toFixed(2)} percent`}
      className={cn('relative h-1 w-full overflow-hidden rounded-full bg-surface-3', className)}
      {...props}
    >
      {pct === null ? (
        // Unknown is drawn as an empty rail, never as a zero-length bar that
        // would read as "measured and it happens to be zero".
        <div className="h-full w-full bg-[repeating-linear-gradient(90deg,hsl(var(--truth-unknown)/0.35)_0_3px,transparent_3px_6px)]" />
      ) : (
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  );
});
Progress.displayName = 'Progress';

export { Progress };
