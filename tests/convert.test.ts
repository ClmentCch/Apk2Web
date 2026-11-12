import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeProject, type AnalysisFile } from '../src/lib/analyze';
import { buildSite, type BuildResult } from '../src/lib/convert';
import { apkOnlyProject, demoProject, fixtureDataUrl, readFixtureText } from './fixtures';

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

async function buildDemo(): Promise<BuildResult> {
  const files = demoProject();
  const analysis = await analyzeProject({
    projectName: 'Démo',
    files: filesOf(files),
    readText: (path) => Promise.resolve(readFixtureText(files, path)),
  });
  return buildSite({
    projectName: 'Démo',
    analysis,
    files: filesOf(files),
    readDataUrl: (path) => fixtureDataUrl(files, path),
  });
}

describe('buildSite — reconstructed demo', () => {
  let build: BuildResult;

  beforeAll(async () => {
    build = await buildDemo();
  });

  it('produces the required export structure', () => {
    const paths = build.files.map((file) => file.path);
    expect(paths).toContain('index.html');
    expect(paths).toContain('style.css');
    expect(paths).toContain('script.js');
    expect(paths).toContain('README.md');
    expect(paths).toContain('.htaccess');
    expect(paths).toContain('src/modules/data.js');
    expect(paths).toContain('src/modules/router.js');
    expect(paths).toContain('src/modules/interactions.js');
    expect(build.assets.some((asset) => asset.target.startsWith('assets/images/'))).toBe(true);
    expect(build.assets.some((asset) => asset.target.startsWith('assets/sounds/'))).toBe(true);
    expect(build.assets.some((asset) => asset.target.startsWith('assets/fonts/'))).toBe(true);
  });

  it('translates layouts, text, shapes, lists and includes to HTML/CSS', () => {
    expect(build.indexHtml).toContain('Bienvenue &amp; bonne visite');
    expect(build.indexHtml).toContain('id="screen-1"');
    expect(build.indexHtml).toContain('id="screen-2"');
    expect(build.indexHtml).toContain('Pied de page');
    expect(build.indexHtml).toContain('Premier');
    expect(build.indexHtml).toContain("assets/images/logo.png");
    expect(build.indexHtml).toContain('type="number"');
    expect(build.indexHtml).toContain('border-radius:12px');
    expect(build.indexHtml).toContain('border:2px solid');
    expect(build.indexHtml).not.toContain('@string/');
  });

  it('wires Smali navigation to web actions', () => {
    expect(build.indexHtml).toContain('data-a2w-action="navigate"');
    expect(build.indexHtml).toContain('data-a2w-target="screen-2"');
    expect(build.indexHtml).toContain('data-a2w-action="back"');
    expect(build.indexHtml).toContain('data-a2w-id="button_play"');
    const dataModule = build.files.find((file) => file.path === 'src/modules/data.js')?.text ?? '';
    expect(dataModule).toContain('"screens"');
    expect(dataModule).toContain('Partie');
    expect(build.scriptJs).toContain('A2W_ROUTER.init');
  });

  it('inlines image assets in the isolated preview', async () => {
    expect(build.previewHtml).toContain('data:application/octet-stream;base64');
    expect(build.previewHtml).toContain('id="a2w-bridge"');
    expect(build.previewHtml).not.toContain('<script src=');
    expect(build.previewHtml).toContain('Bienvenue');
  });

  it('claims only an honest interactive fidelity', () => {
    expect(build.fidelity).toBe('interactive');
    expect(build.fidelityLabel.toLowerCase()).toContain('simul');
    expect(build.fidelityLabel.toLowerCase()).not.toContain('terminé');
    expect(build.fidelityLabel.toLowerCase()).not.toContain('complet');
    const readme = build.files.find((file) => file.path === 'README.md')?.text ?? '';
    expect(readme).toContain('Aucun code Android');
    expect(readme).toContain('Éléments manquants');
  });
});

describe('buildSite — raw APK / Unity', () => {
  it('falls back to an honest asset gallery and keeps the engine warning', async () => {
    const files = apkOnlyProject();
    const analysis = await analyzeProject({
      projectName: 'APK brut',
      files: filesOf(files),
      readText: (path) => Promise.resolve(readFixtureText(files, path)),
    });
    const build = await buildSite({
      projectName: 'APK brut',
      analysis,
      files: filesOf(files),
      readDataUrl: (path) => fixtureDataUrl(files, path),
    });
    expect(build.fidelity).toBe('assets');
    expect(build.screens).toHaveLength(0);
    expect(build.indexHtml).toContain('Images');
    expect(build.indexHtml).toContain('aucun layout XML exploitable');
    expect(build.capabilities.find((capability) => capability.key === 'engine')?.state).toBe('unsupported');
    expect(build.diagnostics.some((diagnostic) => diagnostic.message.includes('Unity'))).toBe(true);
    expect(build.fidelityLabel).toContain('non reconstruite');
  });

  it('applies edited generated files', async () => {
    const files = demoProject();
    const analysis = await analyzeProject({
      projectName: 'Démo',
      files: filesOf(files),
      readText: (path) => Promise.resolve(readFixtureText(files, path)),
    });
    const build = await buildSite({
      projectName: 'Démo',
      analysis,
      files: filesOf(files),
      edits: { 'style.css': '/* custom */ body{background:#000}' },
      readDataUrl: (path) => fixtureDataUrl(files, path),
    });
    const css = build.files.find((file) => file.path === 'style.css')?.text;
    expect(css).toBe('/* custom */ body{background:#000}');
    expect(build.previewHtml).toContain('/* custom */');
  });
});
