# Agent rules for Akcentura

## Git workflow
- **Always push directly to `main`. Do not open pull requests.**
- Run `npm test` before every push; pushing to `main` deploys the site (see `.github/workflows/pages.yml`).

## Project notes
- Plain HTML/CSS/JS ES modules, no build step, no dependencies. Tests: `node --test` (`npm test`).
- Feedback shown to the learner must say whether it comes from *their* speech ("found in this reading")
  or is only a general tip for their native language — never mix the two.
