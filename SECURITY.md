# Security reporting

This repository is intended for private company development. Do not include credentials, personal data, operational records, or production data in issues or pull requests.

Report suspected vulnerabilities privately to the repository owner or Starq Technologies Pvt. Ltd. Do not publish exploit details while a report is being assessed. The private reporting contact and response expectations are pending company approval; no public security SLA is claimed.

This guidance is a draft for Founder review. It does not claim a completed security audit or certification.

## Dependency check (2026-10-20)

`npm audit --package-lock-only` against the staged lockfile reported 4 critical, 7 high, and 5 moderate advisories. No info or low advisories were reported. npm lists available fixes, including major-version upgrades for Vitest and Tailwind CSS; no dependency changes have been made. Founder decision (Room #10186 and #10188): the 16 development/build/test dependency advisories are accepted solely for establishing this private internal source-control baseline. They remain unresolved; this is not a claim that dependencies are fixed or a general execution waiver. Track proportionate remediation and verification before routine execution of affected tooling or enabling CI. Independent review found all 16 advisories in development/build/test dependencies and none in production dependencies. No dependency changes have been made. The checked `package-lock.json` SHA-256 is `C0B5AD50103DFF4A4ECA2BD6ED39FEE8618FDF847A5865314CC08DDC36DF2C45`.
