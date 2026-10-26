import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium tracking-wide transition-colors',
  {
    variants: {
      variant: {
        default: 'border-border bg-secondary text-secondary-foreground',
        outline: 'border-border bg-transparent text-muted-foreground',
        ok: 'border-truth-ok/30 bg-truth-ok-soft text-truth-ok',
        stale: 'border-truth-stale/30 bg-truth-stale-soft text-truth-stale',
        drift: 'border-truth-drift/30 bg-truth-drift-soft text-truth-drift',
        unknown: 'border-truth-unknown/30 bg-truth-unknown-soft text-truth-unknown',
        hold: 'border-truth-hold/30 bg-truth-hold-soft text-truth-hold',
        founder: 'border-truth-founder/30 bg-truth-founder-soft text-truth-founder',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
