/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /*
       * TWO FAMILIES, ONE RULE (Founder QA seq 8410 -> polish seq 8411).
       *
       * The measured defect was that prose and data were typographically
       * identical: 82.5% of Activity's text-bearing elements were monospace,
       * and the 300-character duty capacity notes were set in 10.5px mono.
       * An operator could not tell a sentence from a digest.
       *
       * So the families now carry MEANING, not preference:
       *
       *   sans  Space Grotesk. Every human-facing surface: navigation, page
       *         and peer titles, company/room/product names, headings, tabs,
       *         explanatory prose, buttons and links, record summaries.
       *
       *   mono  Reserved for machine-significant values ONLY: hashes, paths,
       *         ids, sequence numbers, timestamps, provenance and declared
       *         state tokens. Anything an operator READS AS A SENTENCE must
       *         not be in this family.
       *
       * Space Grotesk is self-hosted from public/fonts (no CDN dependency —
       * this is a local-first, read-only operating surface). It is a variable
       * font, so 400/500/600/700 all come from one 22KB file.
       */
      fontFamily: {
        sans: ['"Space Grotesk"', 'Inter var', 'Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Consolas', 'ui-monospace', 'monospace'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        surface: {
          0: 'hsl(var(--surface-0))',
          1: 'hsl(var(--surface-1))',
          2: 'hsl(var(--surface-2))',
          3: 'hsl(var(--surface-3))',
        },
        // Truth-state semantics. Deliberately NOT the shadcn default palette:
        // these carry meaning in this product and must not be re-themed away.
        truth: {
          ok: 'hsl(var(--truth-ok))',
          ok_soft: 'hsl(var(--truth-ok-soft))',
          stale: 'hsl(var(--truth-stale))',
          stale_soft: 'hsl(var(--truth-stale-soft))',
          drift: 'hsl(var(--truth-drift))',
          drift_soft: 'hsl(var(--truth-drift-soft))',
          unknown: 'hsl(var(--truth-unknown))',
          unknown_soft: 'hsl(var(--truth-unknown-soft))',
          hold: 'hsl(var(--truth-hold))',
          hold_soft: 'hsl(var(--truth-hold-soft))',
          founder: 'hsl(var(--truth-founder))',
          founder_soft: 'hsl(var(--truth-founder-soft))',
        },
        stage: {
          implemented: 'hsl(var(--stage-implemented))',
          partial: 'hsl(var(--stage-partial))',
          schema_only: 'hsl(var(--stage-schema-only))',
          test_only: 'hsl(var(--stage-test-only))',
          absent: 'hsl(var(--stage-absent))',
          unknown: 'hsl(var(--stage-unknown))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xs: 'calc(var(--radius) - 6px)',
      },
      /*
       * READABILITY RAMP (Founder QA seq 8410).
       *
       * Measured: 99.8% of Activity's text sat below 12px, 66.5% below 11px,
       * and the floor was 9px. The `micro` tier existed to carry dense
       * provenance, but it had become the default for prose.
       *
       * `micro` is raised 10px -> 11px and `2xs` 11px -> 12px. The floor for
       * anything an operator reads as a sentence is now 12px; 11px is the
       * provenance band only. Nothing in the product goes below 10.5px, and
       * the places that did are addressed at their component, not by scaling
       * the whole ramp down again.
       */
      fontSize: {
        '2xs': ['0.75rem', { lineHeight: '1.1rem' }],
        micro: ['0.625rem', { lineHeight: '0.9rem' }],
        body: ['0.8125rem', { lineHeight: '1.45', fontWeight: '400' }],
        'body-strong': ['0.8125rem', { lineHeight: '1.45', fontWeight: '600' }],
        label: ['0.6875rem', { lineHeight: '1rem', fontWeight: '500' }],
        'label-mono': ['0.6875rem', { lineHeight: '1rem', fontWeight: '500', letterSpacing: '0.02em' }],
      },
      spacing: {
        rail: '3.25rem',
        'rail-expanded': '15rem',
        topbar: '2.5rem',
      },
      boxShadow: {
        frost: '0 1px 0 0 hsl(var(--border) / 0.6) inset, 0 8px 24px -12px hsl(0 0% 0% / 0.7)',
        lift: '0 1px 0 0 hsl(var(--border) / 0.5) inset, 0 16px 40px -20px hsl(0 0% 0% / 0.85)',
        inset: 'inset 0 1px 0 0 hsl(var(--foreground) / 0.04)',
      },
      backgroundImage: {
        'frost-line': 'linear-gradient(180deg, hsl(var(--foreground) / 0.05), transparent 40%)',
      },
      keyframes: {
        'fade-rise': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'sweep': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(300%)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
      },
      animation: {
        'fade-rise': 'fade-rise 260ms cubic-bezier(0.22, 1, 0.36, 1)',
        sweep: 'sweep 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        'pulse-soft': 'pulse-soft 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite',
      },
    },
  },
  plugins: [],
};
