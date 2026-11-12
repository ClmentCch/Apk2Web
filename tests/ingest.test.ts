import { describe, expect, it } from 'vitest';
import { ingestFromFileList } from '../src/lib/ingest';
import { textToBytes, writeZip } from '../src/lib/zip';
import { demoProject, pngBytes } from './fixtures';

describe('ingestFromFileList', () => {
  it('unzips a decompiled archive, strips the wrapper folder and resolves kinds', async () => {
    const fixture = demoProject();
    const entries = [...fixture.entries()].map(([path, data]) => ({ path: `MonApp/${path}`, data }));
    const zipped = writeZip(entries);
    const copy = new Uint8Array(zipped.byteLength);
    copy.set(zipped);
    const file = new File([copy.buffer], 'MonApp.zip', { type: 'application/zip' });

    const result = await ingestFromFileList([file]);
    expect(result.strippedRoot).toBe('MonApp');
    expect(result.files.length).toBe(fixture.size);
    const paths = result.files.map((entry) => entry.path);
    expect(paths).toContain('AndroidManifest.xml');
    expect(paths).toContain('res/layout/activity_main.xml');
    expect(paths).toContain('smali/com/example/demo/MainActivity.smali');
    const image = result.files.find((entry) => entry.path.endsWith('logo.png'));
    expect(image?.kind).toBe('image');
    expect(image?.mime).toBe('image/png');
    expect(result.hasApk).toBe(false);
    expect(result.warnings.join(' ')).not.toContain('APK brut');
  });

  it('flags a raw APK and keeps its readable resources', async () => {
    const zipped = writeZip([
      { path: 'assets/icon.png', data: pngBytes() },
      { path: 'AndroidManifest.xml', data: new Uint8Array([3, 0, 8, 0]) },
    ]);
    const copy = new Uint8Array(zipped.byteLength);
    copy.set(zipped);
    const apk = new File([copy.buffer], 'Jeu.apk', { type: 'application/vnd.android.package-archive' });
    const result = await ingestFromFileList([apk]);
    expect(result.hasApk).toBe(true);
    expect(result.archives).toContain('Jeu.apk');
    expect(result.files.map((entry) => entry.path)).toContain('assets/icon.png');
    expect(result.warnings.join(' ')).toContain('binaires');
  });

  it('skips junk files and enforces size limits', async () => {
    const junk = new File([textToBytes('x').buffer as ArrayBuffer], '.DS_Store');
    const big = new File([new Uint8Array(2048).buffer], 'assets/big.bin');
    const result = await ingestFromFileList([junk, big], {
      maxFileSize: 1024,
      maxTotalSize: 4096,
      maxFiles: 10,
    });
    expect(result.files).toHaveLength(0);
    expect(result.warnings.join(' ')).toContain('dépasse la limite');
  });

  it('accepts a folder-like FileList with relative paths', async () => {
    const files = [
      new File([textToBytes('<manifest/>').buffer as ArrayBuffer], 'AndroidManifest.xml'),
      new File([textToBytes('ok').buffer as ArrayBuffer], 'res/values/strings.xml'),
    ];
    Object.defineProperty(files[1], 'webkitRelativePath', { value: 'Projet/res/values/strings.xml' });
    const result = await ingestFromFileList(files);
    const paths = result.files.map((entry) => entry.path);
    expect(paths).toContain('AndroidManifest.xml');
    expect(paths).toContain('Projet/res/values/strings.xml');
  });
});
