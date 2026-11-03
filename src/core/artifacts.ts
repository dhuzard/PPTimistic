import fs from 'node:fs/promises';
import path from 'node:path';
import { sourceFingerprint, type BuildState } from './build.js';
import { exists, hashFile, loadProject, safePath } from './io.js';
import type { Issue } from '../validation/index.js';

export type ArtifactStatus = {
  locale: string;
  file: string;
  status: 'current' | 'missing' | 'untracked' | 'modified' | 'stale' | 'unverifiable';
  sha256?: string;
  sourceFingerprint: string;
};

export async function inspectArtifacts(name: string, locale?: string): Promise<ArtifactStatus[]> {
  const { dir, config, deck, theme } = await loadProject(name);
  const statePath = await safePath(dir, 'output/build-state.json');
  const state: BuildState | undefined = await exists(statePath)
    ? JSON.parse(await fs.readFile(statePath, 'utf8'))
    : undefined;
  const locales = locale ? [locale] : config.output_locales;
  const result: ArtifactStatus[] = [];
  for (const lang of locales) {
    if (!config.output_locales.includes(lang)) throw new Error(`Output locale is not configured: ${lang}`);
    const file = await safePath(dir, path.join('output', `presentation.${lang}.pptx`));
    const currentSource = await sourceFingerprint(dir, config, deck, theme, lang);
    if (!(await exists(file))) {
      result.push({ locale: lang, file, status: 'missing', sourceFingerprint: currentSource });
      continue;
    }
    const sha256 = await hashFile(file);
    const recordedFile = state?.files?.[lang];
    const recordedSource = state?.provenance?.[lang]?.sourceFingerprint;
    const status = !recordedFile ? 'untracked'
      : sha256 !== recordedFile ? 'modified'
      : !recordedSource ? 'unverifiable'
      : recordedSource !== currentSource ? 'stale'
      : 'current';
    result.push({ locale: lang, file, status, sha256, sourceFingerprint: currentSource });
  }
  return result;
}

export function artifactIssues(statuses: ArtifactStatus[]): Issue[] {
  return statuses.filter(s => s.status !== 'current').map(s => ({
    severity: 'error',
    code: `${s.status}-output`,
    locale: s.locale,
    message: s.status === 'missing' ? 'Presentation has not been built for this locale.'
      : s.status === 'untracked' ? 'Presentation exists without a recorded build. Preserve it and reconcile its origin.'
      : s.status === 'modified' ? 'Presentation differs from its recorded build. Preserve external edits and reconcile them into YAML.'
      : s.status === 'unverifiable' ? 'Presentation has no source fingerprint. Rebuild to establish artifact provenance.'
      : 'Presentation is older than the current project source. Rebuild before delivery.'
  }));
}
