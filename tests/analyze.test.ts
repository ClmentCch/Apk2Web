import { describe, expect, it } from 'vitest';
import { analyzeProject } from '../src/lib/analyze';
import { apkOnlyProject, demoProject, readFixtureText } from './fixtures';
import type { AnalysisFile } from '../src/lib/analyze';

function filesOf(map: Map<string, Uint8Array>): AnalysisFile[] {
  return [...map.entries()].map(([path, bytes]) => ({
    path,
    size: bytes.byteLength,
    kind: path.endsWith('.smali')
      ? 'smali'
      : path.endsWith('.png')
        ? 'image'
        : path.endsWith('.ogg')
          ? 'sound'
          : path.endsWith('.ttf')
            ? 'font'
            : path.endsWith('.xml')
              ? 'xml'
              : path.endsWith('.so')
                ? 'native'
                : 'text',
  }));
}

async function analyzeDemo() {
  const files = demoProject();
  return analyzeProject({
    projectName: 'Démo',
    files: filesOf(files),
    readText: (path) => Promise.resolve(readFixtureText(files, path)),
  });
}

describe('analyzeProject — decompiled project', () => {
  it('reads the manifest, package, labels and permissions', async () => {
    const analysis = await analyzeDemo();
    expect(analysis.packageName).toBe('com.example.demo');
    expect(analysis.appLabel).toBe('Démo APK2WEB');
    expect(analysis.versionName).toBe('1.2.0');
    expect(analysis.permissions).toContain('INTERNET');
    expect(analysis.launcherActivity).toBe('com.example.demo.MainActivity');
    expect(analysis.isApkOnly).toBe(false);
  });

  it('resolves resources and drawable shapes', async () => {
    const analysis = await analyzeDemo();
    expect(analysis.strings.welcome).toContain('Bienvenue');
    expect(analysis.colors.primary).toBe('#FF3F51B5');
    expect(analysis.dimens.space).toBe('16dp');
    expect(analysis.drawables.rounded.kind).toBe('shape');
    expect(analysis.drawables.rounded.shape?.cornerRadius).toBe(12);
    expect(analysis.drawables.rounded.shape?.strokeWidth).toBe(2);
    expect(analysis.drawables.logo.path).toBe('res/drawable-xhdpi/logo.png');
  });

  it('maps activities to layouts and builds two screens', async () => {
    const analysis = await analyzeDemo();
    expect(analysis.stats.layouts).toBe(3);
    expect(analysis.screens).toHaveLength(2);
    expect(analysis.screens[0].layout).toBe('activity_main');
    expect(analysis.screens[0].activity).toBe('com.example.demo.MainActivity');
    expect(analysis.screens[0].title).toBe('Démo APK2WEB');
    expect(analysis.screens[1].layout).toBe('activity_game');
    expect(analysis.screens[1].title).toBe('Partie');
    expect(analysis.screens[0].root.children.some((child) => child.tag === 'include')).toBe(true);
  });

  it('pairs onClick handlers with resource ids and actions', async () => {
    const analysis = await analyzeDemo();
    const navigate = analysis.interactions.find((interaction) => interaction.action === 'navigate');
    expect(navigate).toBeDefined();
    expect(navigate?.viewId).toBe('button_play');
    expect(navigate?.target).toBe('screen-2');
    expect(navigate?.converted).toBe(true);
    const back = analysis.interactions.find((interaction) => interaction.action === 'back');
    expect(back?.viewId).toBe('button_back');
    expect(back?.converted).toBe(true);
    expect(analysis.interactions.every((interaction) => interaction.converted)).toBe(true);
  });

  it('reports capabilities honestly', async () => {
    const analysis = await analyzeDemo();
    const byKey = Object.fromEntries(analysis.capabilities.map((capability) => [capability.key, capability]));
    expect(byKey.layouts.state).toBe('partial');
    expect(byKey.logic.state).toBe('unsupported');
    expect(byKey.interactions.state).toBe('simulated');
    expect(byKey.persistence.state).toBe('unsupported');
    expect(byKey.network.state).toBe('partial');
    expect(analysis.diagnostics.some((diagnostic) => diagnostic.code === 'analysis-done')).toBe(true);
  });
});

describe('analyzeProject — raw APK', () => {
  it('detects a binary manifest and refuses to pretend layouts exist', async () => {
    const files = apkOnlyProject();
    const analysis = await analyzeProject({
      projectName: 'APK brut',
      files: filesOf(files),
      readText: (path) => Promise.resolve(readFixtureText(files, path)),
    });
    expect(analysis.isApkOnly).toBe(true);
    expect(analysis.screens).toHaveLength(0);
    expect(analysis.diagnostics.some((diagnostic) => diagnostic.code === 'manifest-binary')).toBe(true);
    expect(analysis.diagnostics.some((diagnostic) => diagnostic.code === 'no-layouts')).toBe(true);
    const layoutCapability = analysis.capabilities.find((capability) => capability.key === 'layouts');
    expect(layoutCapability?.state).toBe('unsupported');
    const engine = analysis.engines.find((entry) => entry.key === 'unity');
    expect(engine?.blocksGameplay).toBe(true);
    const capabilities = Object.fromEntries(analysis.capabilities.map((capability) => [capability.key, capability]));
    expect(capabilities.engine.state).toBe('unsupported');
  });
});
