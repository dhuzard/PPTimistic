# Contributing to PPTimistic

Bug reports, documentation improvements and focused code changes are welcome. Read [AGENTS.md](AGENTS.md) for the project architecture and its scientific, privacy and asset-protection requirements.

## Local development

Use Node.js 22.13 or newer and npm. From a fresh checkout:

```sh
npm ci
npm run doctor
npm run check
```

`npm run check` runs TypeScript checks and the test suite. Tests use temporary project roots and do not require credentials. Do not add tests that call paid services or depend on private documents.

To exercise the public fictional demo:

```sh
npm run demo -- --no-render
npm run validate -- --project demo
```

These commands generate local output. Review your working tree before committing: include only intentional source changes. See the [README](README.md) for project creation, optional renderers and command examples. Each command also supports `--help`.

## Proposing a change

For a substantial change, open an issue describing the problem and intended behavior before investing in a large implementation. For a small fix, a focused pull request is sufficient.

- Explain the problem, resulting behavior and how you verified it.
- Add a regression test when a behavior change needs one; keep tests independent of credentials and local personal files.
- Run `npm run check` after code changes. For changes affecting presentation output, build and validate a representative public fixture. If a renderer is available, inspect the rendered output and state exactly what you inspected.
- Preserve stable slide IDs, editable PowerPoint objects, citation provenance and explicit fictional-data labels. Follow the protection rules in [AGENTS.md](AGENTS.md).
- If a tool or check is unavailable, say so in the pull request rather than claiming it passed.

Keep private projects, original documents, generated decks, API keys and confidential screenshots out of commits and public discussions. Use synthetic examples or the public fictional demo to reproduce problems. Check file contents even when `.gitignore` would normally exclude them.

## Reporting problems

Search existing issues first. Include the command you ran, expected and actual behavior, operating system, Node.js version, repository revision and a minimal public reproduction. Remove credentials, invitation URLs, personal paths and confidential content from logs before sharing them.

For suspected vulnerabilities, follow [SECURITY.md](SECURITY.md) before posting technical details publicly. Keep issue and review discussions respectful, specific and focused on the work.
