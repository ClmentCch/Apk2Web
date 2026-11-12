import { textToBytes, writeZip } from './zip';
import type { BuildResult } from './convert';

export interface ExportResult {
  blob: Blob;
  filename: string;
  entries: number;
  bytes: number;
  missing: string[];
}

export interface ExportOptions {
  build: BuildResult;
  readBlob: (path: string) => Promise<Blob | undefined>;
  onProgress?: (done: number, total: number) => void;
}

export async function exportSiteZip(options: ExportOptions): Promise<ExportResult> {
  const { build } = options;
  const entries: { path: string; data: Uint8Array }[] = [];
  const missing: string[] = [];
  const root = 'APK2WEB';

  for (const file of build.files) {
    entries.push({ path: `${root}/${file.path}`, data: textToBytes(file.text) });
  }

  const assets = build.assets;
  let done = 0;
  for (const asset of assets) {
    options.onProgress?.(done, assets.length);
    try {
      const blob = await options.readBlob(asset.source);
      if (!blob) {
        missing.push(asset.source);
        continue;
      }
      entries.push({
        path: `${root}/${asset.target}`,
        data: new Uint8Array(await blob.arrayBuffer()),
      });
    } catch {
      missing.push(asset.source);
    }
    done += 1;
  }
  options.onProgress?.(assets.length, assets.length);

  // Ensure the fixed folder structure always exists, even when empty.
  for (const folder of ['assets/images', 'assets/sounds', 'assets/fonts', 'src/modules']) {
    if (!entries.some((entry) => entry.path.startsWith(`${root}/${folder}/`))) {
      entries.push({ path: `${root}/${folder}/.gitkeep`, data: new Uint8Array() });
    }
  }

  const zipped = writeZip(entries);
  const copy = new Uint8Array(zipped.byteLength);
  copy.set(zipped);
  const blob = new Blob([copy.buffer], { type: 'application/zip' });
  return {
    blob,
    filename: `${safeFilename(build.projectName)}-web.zip`,
    entries: entries.length,
    bytes: blob.size,
    missing,
  };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 15_000);
}

function safeFilename(name: string): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned || 'apk2web';
}
