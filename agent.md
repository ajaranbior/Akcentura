# Agent rules for Akcentura

## Git workflow
- **Always push directly to `main`. Do not open pull requests.**
- Run `npm test` before every push; pushing to `main` deploys the site (see `.github/workflows/pages.yml`).

## Project notes
- Plain HTML/CSS/JS ES modules, no build step, no dependencies. Tests: `node --test` (`npm test`).
- Feedback shown to the learner lists only what was found in *their* speech. Do not show patterns that are
  merely "typical" for their native language (no "typical" / "general tips" items in results or focus lists).
