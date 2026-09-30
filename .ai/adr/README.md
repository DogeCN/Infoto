# Architecture Decision Records

This directory contains ADRs — structured records of significant architectural decisions made in the Infoto project.

## When to Create an ADR

Create an ADR when:

- Choosing between architectural approaches (e.g., monorepo vs. multi-repo, sync engine design)
- Changing data model semantics (e.g., why sha256 addressing instead of sequential IDs)
- Establishing a new project-wide pattern (e.g., two-layer copy for i18n, shared overlay contract)

Do **not** create an ADR for:

- Bug fixes with no architectural impact
- Routine refactoring
- Temporary experiments

## Format

File name: `NNNN-title.md` (zero-padded sequential number, e.g., `0001-no-compat-fallback.md`)

```markdown
# NNNN: [Decision Title]

- **Date**: YYYY-MM-DD
- **Status**: Accepted / Superseded by NNNN / Deprecated
- **Context**: What is the problem? What constraints exist?
- **Decision**: What was decided? Be specific.
- **Consequences**: What are the positive/negative outcomes? What becomes harder/easier?
- **Alternatives considered**: What else was evaluated and why rejected?
```

## Index

| ADR                                             | Title                                                          | Status   |
| ----------------------------------------------- | -------------------------------------------------------------- | -------- |
| [0001](0001-sha256-addressing.md)               | sha256 Addresses Photos, Not Sequential IDs                    | Accepted |
| [0002](0002-progress-only-real-measurements.md) | Progress Reports Only Real Measurements                        | Accepted |
| [0003](0003-measured-responsive-layout.md)      | Responsive State From Measured Widths, Not Breakpoints         | Accepted |
| [0004](0004-two-layer-i18n-copy.md)             | Two-Layer i18n Copy: `$state` vs Live Proxy                    | Accepted |
| [0005](0005-waterfall-target-band-width.md)     | Waterfall Density Controlled by Target Band Width              | Accepted |
| [0006](0006-dual-source-web-fonts.md)           | Web Fonts Race the Official Host Against the USTC Mirror       | Accepted |
| [0007](0007-shared-frontend-lifecycle.md)       | Shared Frontend Lifecycle and Utility Boundaries               | Accepted |
| [0008](0008-explicit-sync-triggers.md)          | Synchronization Uses Explicit User and Page-Lifecycle Triggers | Accepted |
