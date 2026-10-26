import * as React from 'react';
import { cn } from '@/lib/utils';

/** A skeleton that reads as "measuring", never as "empty". */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('relative overflow-hidden rounded-sm bg-surface-3', className)}
      {...props}
    >
      <div className="absolute inset-0 -translate-x-full animate-sweep bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent" />
    </div>
  );
}

export { Skeleton };
