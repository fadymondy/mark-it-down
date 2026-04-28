# Contributing

Contributions are **welcome** and will be fully **credited**.

Please read and understand the contribution guide before creating an issue or pull request.

## Etiquette

This project is open source, and as such, the maintainers give their free time to build and maintain the source code held within. They make the code freely available in the hope that it will be of use to other developers. It would be extremely unfair for them to suffer abuse or anger for their hard work.

Please be considerate towards maintainers when raising issues or presenting pull requests. Let's show the world that developers are civilized and selfless people.

It's the duty of the maintainer to ensure that all submissions to the project are of sufficient quality to benefit the project. Many developers have different skills, strengths, and weaknesses. Respect the maintainer's decision, and do not be upset or abusive if your submission is not used.

## Viability

When requesting or submitting new features, first consider whether it might be useful to others. Open source projects are used by many developers, who may have entirely different needs to your own. Think about whether or not your feature is likely to be used by other users of the project.

## Procedure

Before filing an issue:

- Attempt to replicate the problem to ensure it wasn't a coincidental incident
- Check existing issues — your bug or feature may already be tracked
- Check open pull requests in case a fix or feature is already in progress

Before submitting a pull request:

- Verify the build works: `npm run compile`
- Test the extension manually via F5 in VSCode (Run Extension config)
- If you change the webview, run `npm run compile:webview` and verify in `out/webview/main.js`
- Add or update tests if applicable
- Update CHANGELOG.md (`Unreleased` section)

## Requirements

- **Node 20+** for the build pipeline
- **VSCode 1.85+** target — we use modern Custom Editor API features
- **TypeScript strict mode** — no `any` types without explicit justification

### Code style

- 2-space indentation, single quotes, trailing commas (Prettier defaults)
- Async/await over `.then()`
- Explicit error handling — no silent catches; surface to the user when relevant
- Webview ↔ extension messages defined in `src/shared/messages.ts` with discriminated unions
- No direct DOM manipulation in TypeScript when a renderer (e.g. marked) handles it

### Pull request hygiene

- One concern per PR
- Coherent commit history — squash WIP commits before opening the PR
- Use your own git config — **no `Co-Authored-By: Claude` lines** in commits or PR bodies
- PR body must include `Closes #N` when fixing an issue

### Versioning

We follow [SemVer 2.0](https://semver.org). Command IDs, custom editor view types, and configuration property names are public API. Breaking changes warrant a major bump.

**Happy contributing!**
