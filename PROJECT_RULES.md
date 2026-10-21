# Project Rules — RToolsSite

This project is managed under the PC-wide rules in `R:\_System\RULES.md` (that file wins on conflict).
Registry entry: `R:\_System\REGISTRY.md` → **RToolsSite**.

## Locations
- Canonical: `C:\Users\chase\Box\Wisconsin PhD\RToolsSite` (Box-primary)
- Box (if Box-primary, Box is canonical and R: is a mirror): `C:\Users\chase\Box\Wisconsin PhD\RToolsSite`; mirror at `R:\Research\Wisconsin\Other\RToolsSite` (never edit)
- Scratch (fast, disposable): `C:\Scratch\Research\RToolsSite`
- Shared data used (read via config, do not copy): none. The public MS test corpus (`MS_CORPUS`) is local-only, re-downloadable, and lives under `DATA_ROOT`.

## Must-dos
1. **Paths from config only.** Read `PROJECT_ROOT`, `SCRATCH_ROOT`, `DATA_ROOT` (and `BOX_ROOT`) from
   `.env` (git-ignored; template `.env.example`). No absolute paths in code.
2. **Reconcile scratch → canonical.** Interactive project: at the end of every session that wrote to scratch.
   Command: `powershell -File R:\_System\scripts\reconcile.ps1 -Project RToolsSite`
3. **Compute gate.** Heavy CPU/GPU/RAM jobs, local LLMs, or bulk LLM API calls must acquire a slot via
   `R:\_System\scripts\compute-gate` first, run in blocks of at most 2 h, checkpoint, and release.
   Slot class: none for normal work (browser-only site); the optional corpus backtests are cpu-heavy, so use `cpu-heavy`. Run window: none. Exempt: no.
4. **Schedules** must be listed in the registry; prefer the nightly orchestrator over new scheduled tasks. This project has none.
5. **Backups.** Push to the git remote at least daily (github.com/chasegibson04/chases-research-tools, PUBLIC). Secrets come from
   `R:\AI-Slop\_secrets` / a gitignored `.env`, never committed, never on scratch.
6. **Destructive operations** (delete/purge/force-push/overwrite canonical data) need the user's OK in chat.

## Project-specific
- The repo and all branch previews are PUBLIC: no internal lab data, `CV_source/`, `CVDocsTransfer/`, recovery material, or keys in git (see `AGENTS.md`).
- Box Drive drops dotfiles and git objects; never move the repo through Box (use `git clone`).
