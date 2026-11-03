import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { deckSchema, projectSchema, themeSchema } from './model.js';

export const root = process.cwd();
export async function exists(p: string) { try { await fs.access(p); return true; } catch { return false; } }
export function within(base: string, relative: string) {
  const target = path.resolve(base, relative);
  const rel = path.relative(path.resolve(base), target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Path must stay inside ${base}: ${relative}`);
  return target;
}
// Reject symlinks too: imported documents and authored manifests cannot escape a project.
export async function safePath(base: string, relative: string) {
  const result = within(base, relative);
  const realBase = await fs.realpath(base);
  let cursor = result;
  while (!(await exists(cursor))) {
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error('Cannot resolve path');
    cursor = parent;
  }
  const real = await fs.realpath(cursor);
  within(realBase, path.relative(realBase, real));
  return result;
}
export async function readYaml(p: string) { return YAML.parse(await fs.readFile(p, 'utf8')); }
export async function writeYaml(p: string, value: unknown) { await atomicWrite(p, YAML.stringify(value)); }
export async function atomicWrite(p: string, data: string | Buffer) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const temp = `${p}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, data);
  try { await fs.rename(temp, p); } catch (error) { await fs.rm(temp, { force: true }); throw error; }
}
export const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const hashFile = async (p: string) => hash(await fs.readFile(p));
export const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
export function projectDir(name: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) throw new Error('Project name must contain only letters, digits, underscores or hyphens.');
  return within(path.join(root, 'projects'), name);
}
export async function loadProject(name: string) {
  const dir = projectDir(name);
  const config = projectSchema.parse(await readYaml(await safePath(dir, 'project.yaml')));
  const deck = deckSchema.parse(await readYaml(await safePath(dir, config.content)));
  const theme = themeSchema.parse(await readYaml(within(path.join(root, 'config/themes'), `${config.theme}.yaml`)));
  if (config.font) theme.font = config.font;
  return { dir, config, deck, theme };
}
