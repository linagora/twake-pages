# Decisions

Decisions taken on twake-pages, oldest first. Append only: a decision that changes gets a new entry that replaces the old one and cites it. Entry format: the `twake-decisions` skill of [linagora/twake-guidelines](https://github.com/linagora/twake-guidelines/blob/main/skills/twake-decisions/SKILL.md).

Categories: UX, UI, Product, Architecture, Infra, Tech.

## 2026-11-24, [Architecture] Decisions log at the root for an app

- Decision: The app keeps one `docs/decisions.md` at the repo root for all its workspaces (`apps/backend`, `apps/frontend`, `e2e`); only a library monorepo, whose packages are published on their own, keeps one log per package.
- Decided by: Crash-- (CTO), comment on [linagora/twake-contacts-frontend#688](https://github.com/linagora/twake-contacts-frontend/pull/688), 2026-11-24
- Why: the workspaces of an app ship together as one product, so its decisions belong in one log.
- Scope: the whole repository.
