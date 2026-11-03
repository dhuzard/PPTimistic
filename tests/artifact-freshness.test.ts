import { afterAll, beforeAll, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';

const exec = promisify(execFile);
const repo = process.cwd();
let sandbox: string;
const source = () => path.join(sandbox, 'projects/freshness/content/slides.yaml');
const output = (locale: string) => path.join(sandbox, `projects/freshness/output/presentation.${locale}.pptx`);

async function cli(...args: string[]) {
  try {
    const run = await exec(process.execPath, [
      '--import', pathToFileURL(path.join(repo, 'node_modules/tsx/dist/loader.mjs')).href,
      path.join(repo, 'src/cli/index.ts'), ...args
    ], { cwd: sandbox, timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    return { code: 0, output: run.stdout + run.stderr };
  } catch (error) {
    const run = error as { code: number; stdout: string; stderr: string };
    return { code: run.code, output: run.stdout + run.stderr };
  }
}

beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pptimistic-artifact-test-'));
  await fs.cp(path.join(repo, 'config'), path.join(sandbox, 'config'), { recursive: true });
  expect((await cli('setup', '--yes', '--project', 'freshness', '--locales', 'en-US', '--no-render')).code).toBe(0);
}, 60000);

afterAll(async () => { await fs.rm(sandbox, { recursive: true, force: true }); });

test('project commands accept an npm-forwarded positional project name', async () => {
  const positional = await cli('validate', 'freshness');
  expect(positional.code).toBe(0);
  expect(positional.output).toContain('"errors": 0');
  expect((await cli('validate', '--project', 'freshness')).code).toBe(0);
  const ambiguous = await cli('validate', 'freshness', '--project', 'demo');
  expect(ambiguous.code).not.toBe(0);
  expect(ambiguous.output).toContain('Specify the project once');
}, 60000);

test('delivery validation distinguishes stale, modified, and missing PPTX from source validation', async () => {
  expect((await cli('validate', '--project', 'freshness')).output).toContain('"errors": 0');
  const original = YAML.parse(await fs.readFile(source(), 'utf8'));
  const changed = structuredClone(original);
  changed.slides[0].content['en-US'].title = 'A revised English title';
  await fs.writeFile(source(), YAML.stringify(changed));

  const stale = await cli('validate', '--project', 'freshness');
  expect(stale.code).not.toBe(0);
  expect(stale.output).toContain('stale-output');
  expect((await cli('validate', '--project', 'freshness', '--source-only')).code).toBe(0);

  expect((await cli('build', '--project', 'freshness', '--locale', 'en-US')).code).toBe(0);
  expect((await cli('validate', '--project', 'freshness')).code).toBe(0);
  changed.slides[0].citations = ['Review fixture'];
  await fs.writeFile(source(), YAML.stringify(changed));
  const secondStale = await cli('validate', '--project', 'freshness');
  expect(secondStale.code).not.toBe(0);
  expect(secondStale.output).toContain('stale-output');
  expect((await cli('build', '--project', 'freshness', '--locale', 'en-US')).code).toBe(0);
  const current = await cli('validate', '--project', 'freshness');
  expect(current.code).toBe(0);
  expect((await cli('validate', '--project', 'freshness', '--source-only')).code).toBe(0);

  await fs.appendFile(output('en-US'), 'external-edit');
  const modified = await cli('validate', '--project', 'freshness');
  expect(modified.code).not.toBe(0);
  expect(modified.output).toContain('modified-output');
  expect((await cli('validate', '--project', 'freshness', '--source-only')).code).toBe(0);

  await fs.rename(output('en-US'), `${output('en-US')}.saved`);
  const missing = await cli('validate', '--project', 'freshness');
  expect(missing.code).not.toBe(0);
  expect(missing.output).toContain('missing-output');
  expect((await cli('validate', '--project', 'freshness', '--source-only')).code).toBe(0);
}, 60000);
