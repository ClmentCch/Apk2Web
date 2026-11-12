import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  addFiles,
  clearEdit,
  deleteProject,
  getBuildSummary,
  getProject,
  getFileBlob,
  getFileText,
  listEdits,
  listFiles,
  listProjects,
  saveBuildSummary,
  saveEdit,
  saveProject,
} from '../src/lib/db';
import type { ImportedFile, ProjectMeta } from '../src/lib/types';

function makeProject(name: string): ProjectMeta {
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    fileCount: 0,
    totalSize: 0,
    status: 'empty',
  };
}

function makeFile(path: string, content: string): ImportedFile {
  const blob = new Blob([content], { type: 'text/plain' });
  return { path, blob, size: blob.size, kind: 'xml', mime: 'application/xml' };
}

describe('IndexedDB storage', () => {
  it('stores, lists, reads and deletes a project with its files', async () => {
    const meta = makeProject('Projet test');
    meta.fileCount = 2;
    meta.totalSize = 20;
    await saveProject(meta);

    const projects = await listProjects();
    expect(projects.some((project) => project.id === meta.id)).toBe(true);
    expect((await getProject(meta.id))?.name).toBe('Projet test');

    await addFiles(meta.id, [
      makeFile('AndroidManifest.xml', '<manifest package="x"/>'),
      makeFile('res/values/strings.xml', '<resources><string name="a">A</string></resources>'),
    ]);
    const files = await listFiles(meta.id);
    expect(files.map((file) => file.path)).toEqual([
      'AndroidManifest.xml',
      'res/values/strings.xml',
    ]);
    expect(await getFileText(meta.id, 'AndroidManifest.xml')).toContain('manifest');
    expect((await getFileBlob(meta.id, 'res/values/strings.xml'))?.size).toBeGreaterThan(0);

    await saveEdit(meta.id, 'res/values/strings.xml', '<resources />');
    expect((await listEdits(meta.id))['res/values/strings.xml']).toBe('<resources />');
    await clearEdit(meta.id, 'res/values/strings.xml');
    expect(Object.keys(await listEdits(meta.id))).toHaveLength(0);

    await saveBuildSummary({
      projectId: meta.id,
      createdAt: Date.now(),
      fidelity: 'interface',
      fidelityLabel: 'Interface reconstruite',
      screens: [{ id: 'screen-1', title: 'Accueil' }],
      diagnostics: [],
      capabilities: [],
      interactions: 0,
    });
    expect((await getBuildSummary(meta.id))?.fidelity).toBe('interface');

    await deleteProject(meta.id);
    expect(await getProject(meta.id)).toBeUndefined();
    expect(await listFiles(meta.id)).toHaveLength(0);
    expect((await listProjects()).some((project) => project.id === meta.id)).toBe(false);
  });

  it('keeps projects isolated from each other', async () => {
    const first = makeProject('Premier');
    const second = makeProject('Second');
    await saveProject(first);
    await saveProject(second);
    await addFiles(first.id, [makeFile('a.xml', 'A')]);
    await addFiles(second.id, [makeFile('b.xml', 'B')]);
    expect((await listFiles(first.id)).map((file) => file.path)).toEqual(['a.xml']);
    expect((await listFiles(second.id)).map((file) => file.path)).toEqual(['b.xml']);
    await deleteProject(first.id);
    await deleteProject(second.id);
  });
});
