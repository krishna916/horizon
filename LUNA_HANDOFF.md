# Luna handoff — Horizon issue #16

Use Superpowers to implement https://github.com/krishna916/horizon/issues/16.

Read and follow, in order:
1. `docs/superpowers/specs/2026-10-17-issue-16-task-backend-design.md`
2. `docs/superpowers/plans/2026-10-17-issue-16-task-backend-implementation.md`
3. `docs/design/tasks-workspace/DESIGN-SPEC.md`, PRD-004 Tasks, Horizon Constitution, repo `AGENTS.md` and `server/AGENTS.md`.

Use `superpowers:using-git-worktrees` for isolated work, then `superpowers:subagent-driven-development` (or `executing-plans` if no subagents) for the approved plan. Follow tests-first for every task, run actual PostgreSQL Testcontainers, and produce verification evidence. Preserve the user's decisions: per-user immutable `TASK-N`, numeric canonical ID, structured JSONB description, date-only due date, presence-aware PATCH, all-own-non-deleted shallow list, newest-first ordering, title normalization, `{items}` envelope. Do not implement frontend/lifecycle/tags/checklists or decide future URL shapes.

Ask the project owner only when a material conflict or uncovered decision blocks implementation. Do not autonomously change the approved design or merge.
