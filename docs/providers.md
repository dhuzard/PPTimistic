# Illustrations, translation and privacy

The shipped application performs extraction, generation, validation and rendering locally. It makes no AI network calls and has no enabled paid provider. `npm install` downloads dependencies; that does not upload presentation documents. No credentials are needed for the demo.

Private project folders, inputs, feedback, assets and outputs are ignored by Git by default. Only the fictional demo's source YAML, style document and source SVG are allowlisted, alongside the deliberately public screenshot under docs/. Review changes before committing; an ignore file is not access control. Keep sensitive data out of the demo folder. Environment secrets belong in `.env` or the process environment; `.env` is ignored. The CLI does not automatically load `.env` in v0.1, so export variables or launch Node with an environment loader when adding an adapter.

## Illustration workflow

Add references to `projects/NAME/assets/reference/`. Ask an agent with image access to inspect them and update `illustration-style.md`. That specification covers palette, technique, stroke, texture, lighting, perspective, geometry, detail, background, proportions, complexity and negative space, and includes a master prompt version. The starter specification explicitly states that no reference analysis has been performed.

`npm run images -- --project NAME [--slide S002]` creates a prompt/provenance JSON per illustrated slide. It records stable ID, prompt, style version, local asset path, SHA-256, provider, model, time, parameters, acceptance and pending/reused status. Existing accepted assets remain intact. Prompt files are preparation artifacts, not claims that a provider was invoked; timestamps describe prompt preparation when no generation occurred. Native diagram/workflow layouts bypass image generation entirely.

```sh
npm run images -- --project NAME --slide S002 --asset "path/to/image.png"
```

This attaches a local file to the slide and retains a dated copy. Replacing an accepted asset requires `--authorize S002`. Accepted imagery is reused on later builds. AI generation is nondeterministic; retain approved original files rather than relying on regeneration. Do not embed generated text in illustrations or depict synthetic imagery as a real scientific result.

## Extension contracts

`src/images/index.ts` exports `ImageProvider`, `IllustrationRequest`, `IllustrationResult`, `ExternalPolicy` and `assertExternalPolicy`. `src/localization/index.ts` exports `TranslationProvider`, localized consistency checks and request preparation. Providers are TypeScript extension points; there is no adapter discovery system, external API implementation or provider selection CLI yet. A local provider can return an existing local asset or a locally produced image. The CLI already supports that workflow through `--asset`.

An image request contains slideId, prompt, styleVersion and outputPath; results contain assetPath, provider, optional model, and parameters. A translation provider receives one localized content object, source/target locales and the glossary, and must return a complete localized object. Test providers without network access; validate returned assets/content before attaching or importing them.

Before an external adapter is enabled, obtain explicit approval for the exact data being transmitted and record the destination, privacy policy and scope. Never send patient-identifiable information. Extracted text and prompts can still contain confidential research details. Use environment variables for credentials, document the adapter's retention behavior, and never log secrets.

`assertExternalPolicy` requires approved external transmission and finite nonnegative cost values. A paid call requires explicit paid-call approval or a sufficient configured spending limit. It is a helper, not a full billing ledger: an adapter must enforce cumulative spending, timeouts, redaction, response validation and approvals itself. No external invocation path is shipped, so there is no hidden paid call or implied service authorization.
