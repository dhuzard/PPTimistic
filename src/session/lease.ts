import fs from 'node:fs/promises';
import { exists, projectDir, safePath } from '../core/io.js';

/** CLI writers must use the active session API so exports and edits share one queue. */
export async function assertNoActiveSession(project: string) {
  const dir = projectDir(project);
  if (!await exists(dir)) return;
  const lease = await safePath(dir, '.session/server.lock');
  if (!await exists(lease)) return;
  const { pid } = JSON.parse(await fs.readFile(lease, 'utf8')) as { pid: number };
  let alive = true;
  try { process.kill(pid, 0); } catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
  if (alive) throw new Error(`Project ${project} has an active shared session. Make changes and export through its browser/API, or stop the session before using CLI writers.`);
}
