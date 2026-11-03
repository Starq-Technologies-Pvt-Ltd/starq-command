# Starq Command — V2 design canvas snapshot

Raw `.dc.html` source for every screen drafted so far in the Claude design
canvas (https://claude.ai/artifact/KUXVgcxiVXhpCHra5befcU — private; not all
viewers can open it, hence this snapshot). Pushed here so local sessions can
retrieve the files directly without needing artifact access.

**Design-only. Nothing here is wired into the app build.** Open any `.dc.html`
file directly in a browser to preview it (each is self-contained).

Screens: Main (Founder Home), Organization, Workforce, Projects, Activity,
Comms, Attention.

Uses real `lucide-static` icon paths matching `src/components/shell.tsx`'s
`NAV` array (16-item order and destinations preserved), Command's own
`--rail`/`--rail-expanded` sidebar tokens (52px/240px), and a 4-font system
(Space Grotesk for brand/headings, Geist for interface, Sora reserved for
dashboard figures, JetBrains Mono for technical/truth tokens) per the
Founder's latest direction in issue #26.

Known open items from the last QA pass: heading hierarchy gaps on
Workforce/Attention/Comms (no `<h2>` elements yet), and the 4-font role spec
still needs writing up formally for the eventual docs PR.
