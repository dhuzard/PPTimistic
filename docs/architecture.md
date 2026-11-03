# Architecture and content model

The engine is local and agent-independent. YAML is the editable source; PptxGenJS assembles an actual Open XML PPTX. TypeScript runs through tsx, with separate strict type checking. There is no web app, database, background agent or mandatory network service.

```text
config/              reusable themes and documented defaults
src/cli/             guided setup and portable commands
src/core/            schemas, projects, diagnostics, build snapshots
src/content/         source extraction, provenance, literal Markdown plans
src/layouts/         nine native PowerPoint layouts, geometry records
src/images/          provider contract, local assets, prompts and metadata
src/localization/    manual translation requests and consistency checks
src/feedback/        feedback log and structured source revisions
src/rendering/       LibreOffice/Poppler or Windows PowerPoint rendering
src/validation/      content, contrast, source hashes and PPTX checks
projects/<name>/     isolated presentation source and output
templates/project/   minimal source examples
examples/            Markdown plan and revision examples
tests/               local unit and actual PPTX integration tests
```

## Project configuration

```yaml
version: 1
title: My study
source_locale: fr-FR
output_locales: [fr-FR, en-US]
theme: editorial-minimal
content: content/slides.yaml
font: Inter  # optional; install locally, do not commit a proprietary font
glossary: [DVC]  # exact protected spellings, identical across languages
```

The default theme uses white `FFFFFF`, near-black `161616`, gray `52525B` and teal `225E63`. Theme files centralize headings, body size, margins, palette and font. All decks are 16:9. Arial is the reliable default; configure Inter when installed. `config/defaults.yaml` supplies the CLI's starter source language, output languages and theme. Each project retains its own saved settings afterward.

## Slides

```yaml
version: 1
slides:
  - id: S001
    layout: workflow
    status: draft
    locked: false
    evidence: conceptual
    source_refs: []
    citations: []
    content:
      fr-FR:
        title: Une progression explicite
        message: Rendre chaque étape vérifiable.
        body: Exemple de schéma conceptuel.
        notes: Aucune donnée expérimentale n'est représentée.
        labels: [Sources, Relecture, Partage]
        caption: ''
        alt: ''
        seriesNames: []
        review: draft
      en-US:
        title: Make the process explicit
        message: Make every step reviewable.
        body: Conceptual workflow example.
        notes: No experimental data are represented.
        labels: [Sources, Review, Share]
        review: draft
```

The array order controls slide order. IDs never depend on current position after authoring. Do not renumber existing IDs when inserting or moving a slide. `status` and localized `review` support `draft`, `review`, `approved`, `locked`; the optional global `locked` flag also protects the slide. `evidence` is `established`, `interpretation`, `hypothesis`, `conceptual` or `missing`. Citations are user-supplied literal strings, not automatically verified bibliography entries.

Imported translations carry a `source_fingerprint` that records the source wording and shared chart/citation context reviewed for that locale. When those inputs change, validation marks the translation stale and blocks export until review. A layout-only change does not invalidate wording review. Older translations without this field are reported as untracked, rather than as verified current. The fingerprint records review context, not semantic equivalence.

An optional claim link connects one visible source-language field to a locally extracted source excerpt. For example, after ingesting a document, replace the illustrative source ID and excerpt below with values from your own `content/sources.yaml` and `content/extracted/` files:

```yaml
source_refs: [SRC-example]
claims:
  - id: CLM-001
    field: title
    source_ref: SRC-example
    locator: Results, paragraph 2
    excerpt: Exact words from the retained source document.
```

The source ID must be indexed and attached to the slide; the excerpt must match local extracted text after whitespace normalization. The original document and extracted text must retain their recorded hashes. Claim IDs must be unique within the presentation. The link records provenance, not scientific validity: a reviewer must still decide whether the excerpt supports the slide wording. `npm run claims -- --project NAME` prints a local report containing the linked slide field's text in every authored language, source and extraction paths and hashes, locator, excerpt hash and length, and validation status. It also reports whether the current original and extracted bytes match ingestion-time hashes. `--write-markdown` writes `output/claims-report.md` with relative links to those local files. Neither report prints the excerpt itself. Treat reports as potentially confidential because they contain slide text and source paths. Presenter notes include claim IDs and locators but not the extracted passage. For sources without usable extracted text, use ordinary citations and manual review until a suitable local extraction is available.

Layouts: `title`, `statement`, `text-image`, `full-image`, `diagram`, `workflow`, `chart`, `comparison`, `conclusion`. Diagram/workflow labels require 2–5 items. Comparison uses two `labels` as headings and `message`/`body` as the left/right explanations. Full-image uses a separate illustration and an editable title/caption; it is never a rasterized complete slide. Add table support by extending the schema and drawing native `addTable` objects; a dedicated table layout is not included yet.

An illustration uses a project-relative path:

```yaml
visual:
  asset: assets/generated/S001.png
  brief: A conceptual representation of the process, no text.
  accepted: true
```

PNG, JPEG, WebP and SVG assets are accepted. For Office compatibility, only the separate illustration is normalized to PNG at embedding time; the source asset remains intact. All explanatory text belongs in editable slide fields. Provide localized `alt` descriptions. `visual.brief` is language-neutral production metadata, not a translated audience-facing label.

A chart uses native editable PowerPoint charts with an embedded workbook:

```yaml
chart:
  fictional: false
  data_ref: SRC-your-ingested-source-id
  series:
    - values: [8, 12, 10]
source_refs: [SRC-your-ingested-source-id]
# Under each content locale:
# labels: [A, B, C]
# seriesNames: [Supplied measurement]
```

These numbers illustrate the schema; they are not a scientific dataset. Actual charts require supplied data and a source reference. Fictional charts require `fictional: true`. The layout always prints an editable fictional-data disclosure independently of the author caption. English and French disclosures are built in. For another output locale, supply `fictionalNotice` in that slide's localized content, for example `fictionalNotice: Dati fittizi — solo dimostrazione` for `it-IT`. The build rejects a missing notice. A scientific reviewer must confirm any manually supplied wording. For manually transcribed inline values, the validator checks dimensions, reference existence and provenance but cannot verify transcription accuracy.

For a nonfictional chart backed by an ingested CSV, use an explicit binding instead of inline `series` values:

```yaml
chart:
  fictional: false
  data_ref: SRC-your-ingested-csv-id
  binding:
    source_sha256: <sha256 from content/sources.yaml>
    category_column: Group
    value_columns: [Response]
    rows: [2, 3, 4] # 1-based CSV record numbers; row 1 is the header
source_refs: [SRC-your-ingested-csv-id]
# Source-locale labels must match selected Group cells in row order.
# Source-locale seriesNames must match value_columns in order.
```

Column names and rows are selected explicitly; the original CSV bytes must match the recorded hash. PowerPoint chart data and its embedded editable workbook use the selected values directly, without computed transformations. Replacing or re-ingesting a changed CSV does not silently approve new chart values: review the data selection and update `source_sha256` deliberately. The source-language category and series labels are checked against the CSV, while translated labels remain positionally aligned and need human scientific review.

## Validation and rebuilds

Validation rejects duplicate IDs, missing original/target text, unknown or altered sources, missing referenced assets, inconsistent chart labels, invalid language tags, inadequate theme text contrast, probable text overflow, unexpected object intersections and off-slide geometry. It checks ZIP/XML structure, internal relationships, slide count and native text in produced PPTX files. Font consistency is controlled by a single theme; citation/footer text has an intentional 10 pt exception. These checks do not establish scientific truth or guarantee PowerPoint layout under every font substitution.

Build fingerprints include content, theme and asset bytes. Stored protection baselines catch direct YAML edits to approved/locked content, including protected translations and shared layout changes. Accepted illustration paths, bytes and acceptance status are protected independently of slide approval. `--authorize S001,S002` is an explicit allowance, not a request for permission. No authorization is inferred from a rebuild. A newly authored protected slide or accepted image establishes its baseline on its first successful build.

Unchanged illustration files are reused. PPTX ZIPs are reassembled in full; there is no partial-slide ZIP renderer. Builds report changed stable IDs, preserve prior PPTX files and store source snapshots. Each history manifest links archived and newly generated PPTX hashes to their recorded source documents, assets and image-prompt preparations. A prompt record describes preparation or reuse; it does not prove that the prompt generated an accepted image. `validate` checks that exported files are current with authored source; `--source-only` skips that delivery check. Exact binary output may differ because Office metadata contains timestamps; reproducibility means retained source, settings and assets, not guaranteed byte-identical ZIPs. A generated asset is reused rather than regenerated probabilistically.
