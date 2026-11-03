# PPTimistic initial template verification — 3 November 2026

Verified in the standalone PPTimistic checkout on Windows with Node.js v24.16.0 and npm 11.13.0. No paid service, AI API key or external document transmission was used. PowerPoint and Poppler were available; LibreOffice was absent.

| Check | Result |
| --- | --- |
| Clean `npm ci` | Passed; 149 packages installed, zero reported vulnerabilities |
| `npm run check` | TypeScript passed; all 24 tests passed |
| `npm run demo -- --no-render` | Built five-slide English and French PPTX files |
| `npm run validate -- --project demo` | Zero issues and zero errors |
| `npm run render -- --project demo` | PowerPoint produced PNG slides, PDFs and contact sheets for both languages |
| Git exclusions | Private project inputs, demo outputs, source indexes and credentials are ignored |

The tests exercise actual PPTX structure and native editable objects, all nine layouts and three themes, extraction, translations, source provenance, protected content, project isolation and output history. They run in temporary directories without credentials.

Visual inspection: both rendered five-slide contact sheets were opened and inspected. Titles, body text, diagrams and fictional chart labels were visible, with no obvious clipping or overlap at contact-sheet scale. Individual full-resolution slides were not inspected in this template initialization. The refreshed French contact sheet is retained at `docs/demo-contact-sheet.png`.

Generated PPTX files and previews remain local under `projects/demo/output/` and are excluded from Git. The accepted conceptual SVG was preserved unchanged. The demo title S001 and project metadata were renamed to PPTimistic; S002–S005 retain their content and stable IDs.

Only the reusable toolkit, documentation, fictional demo source and its documentation screenshot are intended for publication. Presentation-specific reference images and private project material were excluded. The existing MIT license and original toolkit copyright notice are retained. CI is configured for Linux, Windows and macOS; this verification records the local Windows run. LibreOffice rendering was not exercised. See `limitations.md` for implementation limits.

## Follow-up working-tree verification — 3 November 2026

The release-safeguard changes and optional claim links were checked locally on Windows after the initial template verification above. These results were recorded before publication; the expanded CI workflow had not yet run on GitHub at the time of this local verification.

| Check | Result |
| --- | --- |
| Clean `npm ci` | Passed; 149 packages installed, zero reported vulnerabilities |
| `npm run check` on Node 24.16.0 | TypeScript passed; 59 tests across seven files passed |
| TypeScript and Vitest on Node 22.13.0 | Passed; 59 tests passed |
| `npm run demo -- --no-render` and `npm run validate -- --project demo` | Both English and French PPTX files built; zero validation issues |
| Manual Italian translation fixture | Five slides imported and built in `it-IT`; zero validation issues; S004 supplied a manual fixture `fictionalNotice` |
| PowerPoint rendering | English, French and Italian decks produced actual slide PNGs, PDFs and contact sheets |
| `git diff --check` | Passed |

Visual inspection was performed on both five-slide English/French contact sheets, their full-size S004 chart slides, the five-slide Italian contact sheet, and the full-size Italian S004. The enlarged value labels and fictional-data disclosures were legible; no obvious clipping or overlap was visible in those images. Other full-resolution slides, all theme/layout combinations, LibreOffice output and screen-reader behavior were not visually inspected. The current French contact sheet is retained at `docs/demo-contact-sheet.png`.

The Italian fixture was used to exercise export and layout. Its wording was not independently reviewed for scientific translation fidelity.

The fictional demo source and accepted SVG were not changed. Code changes alter the rendering of S004; no authored slide IDs changed. Generated PPTX files and previews remain local in ignored project output folders.
