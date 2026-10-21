Read AGENTS.md first; it contains all rules for this repository. Then docs/README.md for the index. Log your work in CHANGELOG.agent.log (append-only) as you go.

## PC-wide rules (managed from R:\)
- This project follows `R:\_System\RULES.md` and `./PROJECT_RULES.md`. Read both at the start of a session.
- Canonical copy: `C:\Users\chase\Box\Wisconsin PhD\RToolsSite` (Box-primary: work in the Box path, never in the R: mirror at `R:\Research\Wisconsin\Other\RToolsSite`).
- **End of every session that wrote to scratch** (`C:\Scratch\Research\RToolsSite`): run
  `powershell -File R:\_System\scripts\reconcile.ps1 -Project RToolsSite` and confirm it succeeded.
- Before any heavy compute (many cores, GPU, big RAM, local LLM, bulk API calls): go through
  `R:\_System\scripts\compute-gate`; never run unbounded jobs.
- Don't create scheduled tasks or new top-level folders on any drive yourself — ask the user to do it
  through the R:\ manager session so the registry stays correct.
- Never touch `D:\` contents outside this project's scratch folder.

## Public repo warning
This repo and every branch preview are PUBLIC. Never commit `MIGRATION_RECOVERY.md`, `CVDocsTransfer/`, `CV_source/`, recovery material, internal lab sequences/spectra, or keys. Run `git status --short` and `git grep` before every commit. Remote `origin` = github.com/chasegibson04/chases-research-tools. Box Drive skips dotfiles and git objects: never move this repo through Box; use `git clone`.
