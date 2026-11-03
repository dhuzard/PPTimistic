# PPTimistic

**Because making slides should feel this hopeful.**

Create clean, editable PowerPoint presentations with a coding agent or a local terminal. Keep your sources, scientific claims, illustrations and translations together in one reproducible project. No account, API key or paid service is required.

[Français → README.fr.md](README.fr.md)

![Five-slide French demo, rendered in PowerPoint](docs/demo-contact-sheet.png)

## First presentation

Use **[Use this template → Create a new repository](https://github.com/new?template_name=PPTimistic&template_owner=dhuzard)** on GitHub to create your own copy. Alternatively, clone or download this repository. Your copy can have any name.

```sh
git clone https://github.com/dhuzard/PPTimistic.git pptimistic
cd pptimistic
npm install
npm run setup
```

Install Node.js **22.13 or later** first. Open the folder in VS Code if you want to work with Codex or Claude Code. Setup asks five questions: title, source language, output languages, visual preset and an optional documents folder. Press Enter to accept defaults. The wizard offers English and French; force French with `npm run setup -- --ui fr`.

Setup creates a new project and exports a five-slide demonstration. Without a project name, rerunning setup creates another numbered folder. Explicit names are never overwritten. For an unattended first run:

```sh
npm run setup -- --yes --project my-talk --no-render
```

Open `projects/my-talk/output/presentation.en-US.pptx` or `presentation.fr-FR.pptx`. Titles, paragraphs, diagram shapes, arrows and the example chart are editable. The chart contains **fictional demonstration data**. Preview generation is optional and uses installed local tools.

## Your own presentation

```sh
npm run new -- --project research-talk --inputs "path/to/documents" --yes
npm run build -- --project research-talk
npm run validate -- --project research-talk
npm run render -- --project research-talk
```

Documents are copied locally and extracted with provenance. **Importing research documents does not automatically summarize them.** Until you or your agent authors the slide content, the deck remains an explicitly fictional demo. Tell your agent:

> Create this presentation from projects/research-talk/inputs. Use the supplied sources, preserve the slide plan order, flag missing evidence, and write concise slide content and presenter notes. Generate French and English outputs, validate them, then render previews.

For direct Markdown import, use `examples/slide-plan.md` as a guide. Each `##` heading becomes a slide; its text is copied verbatim, without scientific rewriting:

```sh
npm run new -- --project planned-talk --yes --inputs "path/to/plan-folder" --from-plan --locales en-US
```

Large blocks of text fail layout validation instead of being silently shrunk. An agent can refine the source with your editorial approval.

## Illustrations, translations and revisions

Put visual references in `projects/<name>/assets/reference/`. Ask your agent to inspect them and update `illustration-style.md`; no automated style analysis is claimed. `npm run images -- --project research-talk` writes detailed prompts and asset metadata. Native diagrams work without an image service. Attach a local illustration with `--slide S002 --asset "path/to/figure.png"`; replacing accepted assets also needs `--authorize S002`.

French and English demo content is included. Other translations can be supplied manually:

```sh
npm run translate -- --project research-talk --to it-IT
# Fill every translation object in the reported YAML file, then:
npm run translate -- --project research-talk --to it-IT --file "path/to/completed-request.yaml"
npm run build -- --project research-talk
```

Missing translations block that language's export. Numbers, units, DOIs and protected glossary terms are checked. Translation still needs scientific review.

```sh
npm run revise -- --project research-talk --slide S002 --message "Less text; preserve the scientific meaning."
```

Feedback is logged for your coding agent; the CLI does not pretend to interpret natural language. Say, “Apply the feedback on S002 and rebuild; keep approved slides unchanged.” Structured revisions are supported too; see [the workflow guide](docs/workflows.md). Approved or locked content requires explicit authorization for changes. Each successful rebuild keeps earlier output versions. Manually modified PPTX files are detected and never overwritten.

## Help and troubleshooting

```sh
npm run doctor
npm run build -- --help
npm run demo
npm run check
```

If previews are unavailable, install LibreOffice plus `pdftoppm` (Poppler); Windows can also use installed PowerPoint. Set `SOFFICE_PATH` or `PDFTOPPM_PATH` if detection fails. Missing renderers do not stop PPTX export. Set `font` in project YAML to an installed font; Arial is the portable default, and Inter is preferred when available. Do not redistribute proprietary fonts.

For “externally modified PPTX,” keep a separate copy and reconcile its changes into YAML before rebuilding. Direct PowerPoint edits do **not** update source files. Never delete the output or history until edits have been reconciled. For “missing translation” or “text overflow,” complete the translation or shorten the relevant slide; validation identifies its stable ID.

Project folders are ignored by Git by default, except the public fictional demo source. Do not add confidential inputs or generated materials to a public repository. External providers are extension interfaces only; no network AI provider is enabled or called.

See [architecture and content schema](docs/architecture.md), [workflows and manual edit reconciliation](docs/workflows.md), [privacy and providers](docs/providers.md), and [release limitations](docs/limitations.md). PPTimistic is a standalone GitHub template. Your presentation projects remain local unless you deliberately publish them.
