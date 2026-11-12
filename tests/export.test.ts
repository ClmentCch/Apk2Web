import { describe, expect, it } from 'vitest';
import { analyzeProject, type AnalysisFile } from '../src/lib/analyze';
import { buildSite } from '../src/lib/convert';
import { exportSiteZip } from '../src/lib/exporter';
import { readZip } from '../src/lib/zip';
import { demoProject, fixtureBlob, fixtureDataUrl, readFixtureText } from './fixtures';

function filesOf(map: Map<string, Uint8Array>): AnalysisFile[] {
  return [...map.entries()].map(([path, bytes]) => {
    let kind = 'text';
    if (path.endsWith('.smali')) kind = 'smali';
    else if (path.endsWith('.png')) kind = 'image';
    else if (path.endsWith('.ogg')) kind = 'sound';
    else if (path.endsWith('.ttf')) kind = 'font';
    else if (path.endsWith('.xml')) kind = 'xml';
    else if (path.endsWith('.so')) kind = 'native';
    return { path, size: bytes.byteLength, kind };
  });
}

describe('exportSiteZip', () => {
  it('builds a complete, extractable APK2WEB ZIP', async () => {
    const files = demoProject();
    const listing = filesOf(files);
    const analysis = await analyzeProject({
      projectName: 'Démo',
      files: listing,
      readText: (path) => Promise.resolve(readFixtureText(files, path)),
    });
    const build = await buildSite({
      projectName: 'Démo',
      analysis,
      files: listing,
      readDataUrl: (path) => fixtureDataUrl(files, path),
    });
    const result = await exportSiteZip({
      build,
      readBlob: (path) => Promise.resolve(fixtureBlob(files, path)),
    });

    expect(result.filename).toBe('Demo-web.zip');
    expect(result.bytes).toBeGreaterThan(1000);
    expect(result.missing).toHaveLength(0);

    const entries = await readZip(await result.blob.arrayBuffer());
    const paths = entries.map((entry) => entry.path);
    for (const required of [
      'APK2WEB/index.html',
      'APK2WEB/style.css',
      'APK2WEB/script.js',
      'APK2WEB/README.md',
      'APK2WEB/.htaccess',
      'APK2WEB/src/modules/data.js',
      'APK2WEB/src/modules/router.js',
      'APK2WEB/src/modules/interactions.js',
    ]) {
      expect(paths).toContain(required);
    }
    expect(paths.some((path) => path.startsWith('APK2WEB/assets/images/'))).toBe(true);
    expect(paths.some((path) => path.startsWith('APK2WEB/assets/sounds/'))).toBe(true);
    expect(paths.some((path) => path.startsWith('APK2WEB/assets/fonts/'))).toBe(true);

    const html = entries.find((entry) => entry.path === 'APK2WEB/index.html');
    const decoded = new TextDecoder().decode(html?.data);
    expect(decoded).toContain('<!doctype html>');
    expect(decoded).toContain('style.css');
    expect(decoded).not.toContain('data:application/octet-stream');
    expect(paths.some((path) => path.endsWith('logo.png'))).toBe(true);
  });
});
