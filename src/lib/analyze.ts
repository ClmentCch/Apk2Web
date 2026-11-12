import {
  androidAttr,
  normalizeClassName,
  parseShapeDrawable,
  parseXml,
  parseLayoutXml,
  resolveStringRef,
  walkViews,
} from './android';
import { baseName, dirName, formatBytes, humanize } from './files';
import type {
  Analysis,
  ActivityInfo,
  AssetEntry,
  Capability,
  Diagnostic,
  DrawableRef,
  EngineDetection,
  InteractionAction,
  InteractionSpec,
  ScreenSpec,
  ViewNode,
} from './types';

export interface AnalysisFile {
  path: string;
  kind: string;
  size: number;
}

export interface AnalyzeInput {
  projectName: string;
  files: AnalysisFile[];
  readText: (path: string) => Promise<string | null>;
}

const MAX_LAYOUTS = 160;
const MAX_ACTIVITY_SMALI = 260;
const SMALI_READ_LIMIT = 400_000;

interface SmaliHandler {
  handler: string;
  action: InteractionAction;
  targetActivity?: string;
  label: string;
}

export async function analyzeProject(input: AnalyzeInput): Promise<Analysis> {
  const diagnostics: Diagnostic[] = [];
  const files = input.files;
  const cache = new Map<string, string | null>();

  const readText = async (path: string | undefined): Promise<string | null> => {
    if (!path) return null;
    if (cache.has(path)) return cache.get(path) ?? null;
    let text: string | null = null;
    try {
      text = await input.readText(path);
    } catch {
      text = null;
    }
    cache.set(path, text);
    return text;
  };

  const findPath = (regex: RegExp): string | undefined =>
    files.find((file) => regex.test(file.path))?.path;

  function findValuesFile(name: string): string | undefined {
    return (
      findPath(new RegExp(`^res/values/${name}\\.xml$`, 'i')) ??
      findPath(new RegExp(`(^|/)res/values/${name}\\.xml$`, 'i')) ??
      findPath(new RegExp(`(^|/)values/${name}\\.xml$`, 'i'))
    );
  }

  /* ---------------------------------------------------------------- */
  /* Manifest                                                          */
  /* ---------------------------------------------------------------- */
  const manifestPath = findPath(/(^|\/)AndroidManifest\.xml$/i);
  let packageName = 'application';
  let appLabel = input.projectName;
  let versionName: string | undefined;
  let versionCode: string | undefined;
  let launcherActivity: string | undefined;
  let manifestSkipped: string | undefined;
  const permissions: string[] = [];
  let manifestActivities: { name: string; label?: string; launcher: boolean }[] = [];

  if (!manifestPath) {
    diagnostics.push({
      level: 'warn',
      code: 'manifest-missing',
      message:
        "AndroidManifest.xml introuvable : le nom du paquet et la liste des activités n'ont pas pu être lus.",
    });
  } else {
    const manifestText = await readText(manifestPath);
    if (!manifestText) {
      diagnostics.push({
        level: 'error',
        code: 'manifest-unreadable',
        message: 'Le manifeste est illisible (binaire ou encodé).',
      });
    } else if (!manifestText.trimStart().startsWith('<')) {
      manifestSkipped = 'AndroidManifest.xml binaire (APK non décompilé)';
      diagnostics.push({
        level: 'warn',
        code: 'manifest-binary',
        message:
          'AndroidManifest.xml est binaire (format AXML). Décompilez l’APK avec apktool pour obtenir les layouts et les ressources XML lisibles.',
      });
    } else {
      const doc = parseXml(manifestText);
      if (!doc) {
        diagnostics.push({
          level: 'error',
          code: 'manifest-invalid',
          message: 'AndroidManifest.xml est mal formé et n’a pas pu être analysé.',
        });
      } else {
        const root = doc.documentElement;
        packageName = androidAttr(root, 'package') ?? packageName;
        versionName = androidAttr(root, 'versionName') ?? undefined;
        versionCode = androidAttr(root, 'versionCode') ?? undefined;
        const app = Array.from(root.children).find((el) => el.localName === 'application');
        const rawAppLabel = app ? androidAttr(app, 'label') : undefined;
        if (rawAppLabel && !rawAppLabel.startsWith('@')) appLabel = rawAppLabel;

        for (const el of Array.from(root.children)) {
          if (el.localName === 'uses-permission' || el.localName === 'uses-permission-sdk-23') {
            const perm = androidAttr(el, 'name');
            if (perm) permissions.push(perm.replace(/^android\.permission\./, ''));
          }
        }
        if (app) {
          const collect = (el: Element): void => {
            const name = androidAttr(el, 'name');
            if (!name) return;
            const filters = Array.from(el.children).filter(
              (child) => child.localName === 'intent-filter',
            );
            const launcher = filters.some((filter) => {
              const actions = Array.from(filter.children)
                .filter((child) => child.localName === 'action')
                .map((child) => androidAttr(child, 'name'));
              const categories = Array.from(filter.children)
                .filter((child) => child.localName === 'category')
                .map((child) => androidAttr(child, 'name'));
              return (
                actions.includes('android.intent.action.MAIN') &&
                categories.includes('android.intent.category.LAUNCHER')
              );
            });
            manifestActivities.push({
              name: normalizeClassName(name, packageName),
              label: androidAttr(el, 'label'),
              launcher,
            });
          };
          for (const el of Array.from(app.children)) {
            if (el.localName === 'activity' || el.localName === 'activity-alias') collect(el);
          }
        }
        launcherActivity = manifestActivities.find((activity) => activity.launcher)?.name;
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Values / arrays / localizations                                    */
  /* ---------------------------------------------------------------- */
  const localizations = new Set<string>();
  for (const file of files) {
    const match = /^res\/values-([a-zA-Z0-9+-]+)\//.exec(file.path);
    if (match) localizations.add(match[1]);
  }

  const strings = readValueMap(await readText(findValuesFile('strings')), 'string');
  const colors = readValueMap(await readText(findValuesFile('colors')), 'color');
  const dimens = readValueMap(await readText(findValuesFile('dimens')), 'dimen');
  const arrays = readArrays(await readText(findValuesFile('arrays')));

  if (manifestPath) {
    const doc = parseXml((await readText(manifestPath)) ?? '');
    const app = doc
      ? Array.from(doc.documentElement.children).find((el) => el.localName === 'application')
      : undefined;
    const raw = app ? androidAttr(app, 'label') : undefined;
    const resolved = resolveStringRef(raw, strings);
    if (resolved) appLabel = resolved;
    if (manifestActivities.length > 0) {
      manifestActivities = manifestActivities.map((activity) => ({
        ...activity,
        label: activity.label?.startsWith('@string/')
          ? strings[activity.label.slice('@string/'.length)] ?? activity.label
          : activity.label,
      }));
      const launcher = manifestActivities.find((activity) => activity.launcher);
      launcherActivity = launcher?.name ?? launcherActivity;
    }
  }

  /* ---------------------------------------------------------------- */
  /* public.xml: resource id -> name                                    */
  /* ---------------------------------------------------------------- */
  const publicIds: Record<string, { type: string; name: string }> = {};
  const publicText = await readText(findPath(/(^|\/)res\/values\/public\.xml$/i));
  if (publicText) {
    const doc = parseXml(publicText);
    for (const el of Array.from(doc?.getElementsByTagName('public') ?? [])) {
      const type = el.getAttribute('type');
      const name = el.getAttribute('name');
      const id = el.getAttribute('id');
      if (!type || !name || !id) continue;
      if (!Number.isFinite(Number(id))) continue;
      publicIds[idKey(id)] = { type, name };
    }
    if (Object.keys(publicIds).length === 0) {
      diagnostics.push({
        level: 'info',
        code: 'public-xml-empty',
        message:
          'public.xml ne contient aucun identifiant exploitable : les actions ne pourront pas être rattachées à leurs vues.',
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Layouts                                                           */
  /* ---------------------------------------------------------------- */
  const layoutCandidates = files.filter((file) =>
    /^res\/layout(-[a-z0-9-]+)?\/.+\.xml$/i.test(file.path),
  );
  const layoutPaths = new Map<string, string>();
  for (const file of [...layoutCandidates].sort(
    (a, b) => (isDefaultLayout(b.path) ? 1 : 0) - (isDefaultLayout(a.path) ? 1 : 0),
  )) {
    const name = baseName(file.path).replace(/\.xml$/i, '');
    if (!layoutPaths.has(name)) layoutPaths.set(name, file.path);
  }
  if (layoutPaths.size > MAX_LAYOUTS) {
    diagnostics.push({
      level: 'warn',
      code: 'layout-limit',
      message: `${layoutPaths.size} layouts détectés : seuls les ${MAX_LAYOUTS} premiers sont analysés.`,
    });
  }

  const layouts = new Map<string, ViewNode>();
  for (const [name, path] of Array.from(layoutPaths.entries()).slice(0, MAX_LAYOUTS)) {
    const text = await readText(path);
    if (!text) continue;
    const root = parseLayoutXml(text);
    if (!root) {
      diagnostics.push({
        level: 'warn',
        code: 'layout-parse',
        message: `Le layout ${name} n’a pas pu être analysé (XML mal formé, binaire ou introuvable).`,
        detail: path,
      });
      continue;
    }
    layouts.set(name, root);
  }
  if (layouts.size === 0) {
    diagnostics.push({
      level: 'warn',
      code: 'no-layouts',
      message:
        'Aucun layout XML exploitable : la reconstruction d’interface est impossible. Les ressources seront présentées dans une galerie web, avec la liste des éléments manquants.',
    });
  }

  const containerUsage = new Map<string, number>();
  for (const root of layouts.values()) {
    walkViews(root, (node) => {
      containerUsage.set(node.tag, (containerUsage.get(node.tag) ?? 0) + 1);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Drawables                                                          */
  /* ---------------------------------------------------------------- */
  const drawables: Record<string, DrawableRef> = {};
  const drawableCandidates = files
    .filter((file) => file.kind === 'image' && /res\/(drawable|mipmap)(-[a-z0-9-]+)?\//i.test(file.path))
    .sort((a, b) => densityScore(b.path) - densityScore(a.path));
  for (const file of drawableCandidates) {
    const name = baseName(file.path)
      .replace(/\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i, '')
      .replace(/\.9$/, '');
    if (!drawables[name]) drawables[name] = { name, kind: 'image', path: file.path };
  }
  const shapeCandidates = files.filter(
    (file) => file.kind === 'xml' && /res\/drawable(-[a-z0-9-]+)?\/.+\.xml$/i.test(file.path),
  );
  for (const file of shapeCandidates.slice(0, 400)) {
    const name = baseName(file.path).replace(/\.xml$/i, '');
    if (drawables[name]) continue;
    const text = await readText(file.path);
    if (!text) continue;
    drawables[name] = { name, kind: 'shape', path: file.path, shape: parseShapeDrawable(text) };
  }

  /* ---------------------------------------------------------------- */
  /* Smali: activities, layouts, click handlers                         */
  /* ---------------------------------------------------------------- */
  const smaliFiles = files.filter((file) => file.kind === 'smali');
  const smaliByClass = new Map<string, string>();
  for (const file of smaliFiles) {
    const match = /(?:^|\/)smali(?:_classes\d+)?\/(.+)\.smali$/i.exec(file.path);
    if (match) smaliByClass.set(match[1].replace(/\//g, '.'), file.path);
  }

  let discoveredActivities = manifestActivities.map((activity) => activity.name);
  if (discoveredActivities.length === 0) {
    discoveredActivities = Array.from(smaliByClass.keys())
      .filter((name) => /(Activity|Screen|Launcher)$/.test(name.replace(/\$.*/, '')))
      .slice(0, 40);
    if (discoveredActivities.length > 0) {
      diagnostics.push({
        level: 'info',
        code: 'activities-inferred',
        message:
          'Manifeste non exploitable : les activités ont été déduites des noms de fichiers Smali (heuristique).',
      });
    }
  }

  const activityInfos: ActivityInfo[] = [];
  const bindingsByActivity = new Map<string, string[]>();
  const handlersByActivity = new Map<string, SmaliHandler[]>();
  const smaliHasClass = new Set<string>();
  let clickBindingsTotal = 0;

  for (const className of discoveredActivities.slice(0, MAX_ACTIVITY_SMALI)) {
    const smaliPath = smaliByClass.get(className);
    let layout: string | undefined;
    if (smaliPath) {
      smaliHasClass.add(className);
      let text = await readText(smaliPath);
      if (text && text.length > SMALI_READ_LIMIT) text = text.slice(0, SMALI_READ_LIMIT);
      if (text) {
        layout = layoutFromSmali(text, publicIds);
        const bindings = clickIdBindings(text, publicIds);
        bindingsByActivity.set(className, bindings);
        clickBindingsTotal += bindings.length;
        handlersByActivity.set(
          className,
          await loadHandlers(className, smaliByClass, readText),
        );
      }
    }
    if (!layout) layout = inferLayoutForActivity(className, [...layouts.keys()]);
    const manifestInfo = manifestActivities.find((activity) => activity.name === className);
    activityInfos.push({ className, layout, label: manifestInfo?.label });
  }

  /* ---------------------------------------------------------------- */
  /* Screens                                                            */
  /* ---------------------------------------------------------------- */
  const screens: ScreenSpec[] = [];
  const screenByActivity = new Map<string, ScreenSpec>();

  const orderedActivities = [...activityInfos].sort((a, b) => {
    if (a.className === launcherActivity) return -1;
    if (b.className === launcherActivity) return 1;
    return 0;
  });

  for (const activity of orderedActivities) {
    const layout = activity.layout && layouts.has(activity.layout) ? activity.layout : undefined;
    if (!layout) {
      if (smaliHasClass.has(activity.className)) {
        diagnostics.push({
          level: 'info',
          code: 'activity-no-layout',
          message: `Aucun layout identifié pour ${shortClass(activity.className)}.`,
          detail:
            'Interface probablement construite dynamiquement (Jetpack Compose, WebView, moteur de jeu, bibliothèque) : elle n’est pas reconstruite.',
        });
      }
      continue;
    }
    const baseTitle =
      activity.label?.trim() ||
      humanize(shortClass(activity.className).replace(/Activity$|Screen$/i, '')) ||
      humanize(layout);
    const screen: ScreenSpec = {
      id: `screen-${screens.length + 1}`,
      layout,
      activity: activity.className,
      title: uniqueTitle(baseTitle, screens),
      root: layouts.get(layout) as ViewNode,
      origin: 'activity',
    };
    screens.push(screen);
    screenByActivity.set(activity.className, screen);
  }

  if (screens.length === 0 && layouts.size > 0) {
    diagnostics.push({
      level: 'warn',
      code: 'screens-from-layouts',
      message:
        'Aucune activité avec layout identifiée : chaque layout racine est proposé comme écran (affectation approximative).',
    });
    for (const [name, root] of layouts) {
      if (screens.length >= 12) break;
      screens.push({
        id: `screen-${screens.length + 1}`,
        layout: name,
        title: humanize(name),
        root,
        origin: 'layout',
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Interactions                                                       */
  /* ---------------------------------------------------------------- */
  const interactions: InteractionSpec[] = [];
  for (const [className, handlers] of handlersByActivity) {
    const screen = screenByActivity.get(className);
    if (!screen) continue;
    const bindings = bindingsByActivity.get(className) ?? [];
    const pairs = Math.max(bindings.length, handlers.length);
    for (let i = 0; i < pairs; i += 1) {
      const binding = bindings[i];
      const handler = handlers[i];
      const targetScreen = handler?.targetActivity
        ? screenByActivity.get(handler.targetActivity)
        : undefined;
      let action: InteractionAction = handler?.action ?? 'unknown';
      if (action === 'navigate' && !targetScreen) action = 'unknown';
      const viewName = binding ? publicIds[binding]?.name : undefined;
      interactions.push({
        screenId: screen.id,
        viewId: viewName,
        handler: handler?.handler ?? 'inconnu',
        action,
        target: targetScreen?.id,
        targetActivity: handler?.targetActivity,
        label:
          handler?.label ||
          (viewName ? humanize(viewName) : handler ? humanize(handler.handler) : 'Action'),
        converted: action !== 'unknown',
      });
    }
  }

  const convertedClicks = interactions.filter((interaction) => interaction.converted).length;
  if (clickBindingsTotal > 0) {
    diagnostics.push({
      level: convertedClicks >= clickBindingsTotal ? 'info' : 'warn',
      code: 'interactions',
      message: `${convertedClicks}/${clickBindingsTotal} gestionnaire(s) de clic traduits en action web.`,
      detail:
        convertedClicks >= clickBindingsTotal
          ? 'Association vue → action établie par analyse heuristique du Smali.'
          : 'Les actions non identifiées restent inertes et sont listées dans le rapport.',
    });
  }
  if (screens.length > 1 && interactions.every((interaction) => interaction.action !== 'navigate')) {
    diagnostics.push({
      level: 'warn',
      code: 'navigation-missing',
      message:
        'Plusieurs écrans mais aucune navigation startActivity identifiée : la navigation est laissée à l’utilisateur (menu d’écrans du routeur).',
    });
  }

  /* ---------------------------------------------------------------- */
  /* Assets, engines, capabilities                                     */
  /* ---------------------------------------------------------------- */
  const images = collectAssets(files, 'image');
  const sounds = collectAssets(files, 'sound');
  const fonts = collectAssets(files, 'font');
  const nativeLibs = files.filter((file) => file.kind === 'native');
  const engines = detectEngines(files);
  for (const engine of engines) {
    diagnostics.push({
      level: engine.blocksGameplay ? 'warn' : 'info',
      code: `engine-${engine.key}`,
      message: `${engine.label} détecté (${engine.evidence}).`,
      detail: engine.blocksGameplay
        ? "Ce moteur s'exécute sur du code natif/binaire impossible à exécuter dans un navigateur. L'interface Android peut être reconstruite, mais la mécanique du jeu ne peut pas être reproduite."
        : undefined,
    });
  }

  const capabilities = buildCapabilities({
    layouts: layouts.size,
    screens: screens.length,
    images: images.length,
    sounds: sounds.length,
    fonts: fonts.length,
    nativeLibs: nativeLibs.length,
    clickBindings: clickBindingsTotal,
    convertedClicks,
    permissions,
    engines,
    containerUsage,
    hasWebAssets: files.some((file) => /^assets\/www\/index\.html$/i.test(file.path)),
  });

  const stats = {
    layouts: layouts.size,
    activities: activityInfos.length,
    smaliFiles: smaliFiles.length,
    images: images.length,
    sounds: sounds.length,
    fonts: fonts.length,
    nativeLibs: nativeLibs.length,
    xmlFiles: files.filter((file) => file.kind === 'xml').length,
    totalFiles: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
  };

  diagnostics.push({
    level: 'info',
    code: 'analysis-done',
    message: `Analyse terminée : ${stats.totalFiles} fichiers (${formatBytes(stats.totalBytes)}), ${stats.layouts} layouts, ${screens.length} écran(s), ${interactions.length} interaction(s).`,
  });

  return {
    projectName: input.projectName,
    packageName,
    appLabel,
    versionName,
    versionCode,
    launcherActivity,
    permissions,
    isApkOnly: Boolean(manifestSkipped),
    manifestSkipped,
    screens,
    activities: activityInfos,
    interactions,
    strings,
    colors,
    dimens,
    arrays,
    drawables,
    layoutMap: Object.fromEntries(layouts),
    publicIds,
    images,
    sounds,
    fonts,
    engines,
    capabilities,
    diagnostics,
    stats,
    localizations: [...localizations].sort(),
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function idKey(hex: string): string {
  const value = Number(hex);
  if (!Number.isFinite(value)) return hex.toLowerCase();
  return `0x${value.toString(16)}`;
}

function shortClass(className: string): string {
  const value = className.replace(/\$.*$/, '');
  return value.slice(value.lastIndexOf('.') + 1);
}

function uniqueTitle(title: string, screens: ScreenSpec[]): string {
  const base = title.trim() || 'Écran';
  if (!screens.some((screen) => screen.title === base)) return base;
  let index = 2;
  while (screens.some((screen) => screen.title === `${base} (${index})`)) index += 1;
  return `${base} (${index})`;
}

function readValueMap(
  text: string | null,
  kind: 'string' | 'color' | 'dimen',
): Record<string, string> {
  const map: Record<string, string> = {};
  if (!text) return map;
  const doc = parseXml(text);
  if (!doc) return map;
  for (const el of Array.from(doc.documentElement.children)) {
    const name = el.getAttribute('name');
    if (!name) continue;
    if (kind === 'string' && el.localName === 'string') map[name] = el.textContent ?? '';
    else if (kind === 'color' && el.localName === 'color') map[name] = (el.textContent ?? '').trim();
    else if (kind === 'dimen' && el.localName === 'dimen') map[name] = (el.textContent ?? '').trim();
    else if (el.localName === 'item' && el.getAttribute('type') === kind) {
      map[name] = (el.textContent ?? '').trim();
    }
  }
  return map;
}

function readArrays(text: string | null): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  if (!text) return map;
  const doc = parseXml(text);
  if (!doc) return map;
  for (const el of Array.from(doc.documentElement.children)) {
    const name = el.getAttribute('name');
    if (!name) continue;
    if (el.localName !== 'string-array' && el.localName !== 'array') continue;
    map[name] = Array.from(el.children)
      .filter((item) => item.localName === 'item')
      .map((item) => item.textContent ?? '');
  }
  return map;
}

function isDefaultLayout(path: string): boolean {
  return /^res\/layout\//.test(path);
}

function densityScore(path: string): number {
  const dir = dirName(path).toLowerCase();
  const table: [string, number][] = [
    ['-xxxhdpi', 640],
    ['-xxhdpi', 480],
    ['-xhdpi', 320],
    ['-hdpi', 240],
    ['-mdpi', 160],
    ['-nodpi', 100],
  ];
  for (const [suffix, score] of table) if (dir.endsWith(suffix)) return score;
  return 80;
}

function layoutFromSmali(
  text: string,
  publicIds: Record<string, { type: string; name: string }>,
): string | undefined {
  const lines = text.split('\n');
  let lastId: string | undefined;
  let lastIdLine = -100;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const constMatch =
      /const(?:-high16|-wide(?:\/32)?|\/4|\/16)?\s+v\d+,\s*(0x7f[0-9a-fA-F]{5,6})/.exec(line);
    if (constMatch) {
      lastId = constMatch[1];
      lastIdLine = i;
    }
    if (
      /setContentView|LayoutInflater;->inflate|->inflate\(I/.test(line) &&
      lastId &&
      i - lastIdLine < 40
    ) {
      const resolved = publicIds[idKey(lastId)];
      if (resolved?.type === 'layout') return resolved.name;
    }
  }
  return undefined;
}

function inferLayoutForActivity(className: string, layoutNames: string[]): string | undefined {
  const base = shortClass(className)
    .replace(/Activity$|Screen$/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
  if (!base) return undefined;
  const exact = layoutNames.find((name) => name.toLowerCase() === `activity_${base}`);
  if (exact) return exact;
  const contains = layoutNames.find((name) => {
    const lower = name.toLowerCase();
    return lower.includes(base) || name.replace(/_/g, '').toLowerCase().includes(base.replace(/_/g, ''));
  });
  return contains;
}

function clickIdBindings(
  text: string,
  publicIds: Record<string, { type: string; name: string }>,
): string[] {
  const lines = text.split('\n');
  const ids: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/setOnClickListener/.test(lines[i])) continue;
    for (let j = i; j >= Math.max(0, i - 60); j -= 1) {
      const match =
        /const(?:-high16|-wide(?:\/32)?|\/4|\/16)?\s+v\d+,\s*(0x7f[0-9a-fA-F]{5,6})/.exec(lines[j]);
      if (!match) continue;
      const info = publicIds[idKey(match[1])];
      if (info?.type === 'id') ids.push(idKey(match[1]));
      break;
    }
  }
  return ids;
}

async function loadHandlers(
  className: string,
  smaliByClass: Map<string, string>,
  readText: (path: string) => Promise<string | null>,
): Promise<SmaliHandler[]> {
  const handlers: SmaliHandler[] = [];
  for (const [name, path] of smaliByClass) {
    if (handlers.length >= 12) break;
    if (!name.startsWith(`${className}$`)) continue;
    const text = await readText(path);
    if (!text || !/onClick\(Landroid\/view\/View;\)V/.test(text)) continue;
    const body = methodBody(text, /onClick\(Landroid\/view\/View;\)V/);
    if (!body) continue;
    const parsed = actionFromBody(body);
    handlers.push({
      handler: name,
      action: parsed.action,
      targetActivity: parsed.targetActivity,
      label: parsed.label,
    });
  }
  return handlers;
}

function methodBody(text: string, signature: RegExp): string | undefined {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith('.method') || !signature.test(lines[i])) continue;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].startsWith('.end method')) return body.join('\n');
      body.push(lines[j]);
    }
  }
  return undefined;
}

function actionFromBody(body: string): {
  action: InteractionAction;
  targetActivity?: string;
  label: string;
} {
  const target = detectIntentTarget(body);
  if (/startActivity|startActivityForResult/.test(body)) {
    return {
      action: target ? 'navigate' : 'unknown',
      targetActivity: target,
      label: target ? `Ouvrir ${shortClass(target)}` : 'Navigation',
    };
  }
  if (/->finish\(\)V/.test(body)) return { action: 'back', label: 'Retour' };
  if (/setVisibility|setChecked|setSelected|isChecked/.test(body)) {
    return { action: 'toggle', label: 'Basculer l’élément' };
  }
  if (/Toast|makeText|setText\(|Snackbar/.test(body)) {
    return { action: 'notify', label: 'Afficher un message' };
  }
  if (/MediaPlayer|SoundPool|playSound|AudioTrack/.test(body)) {
    return { action: 'sound', label: 'Lire un son' };
  }
  return { action: 'unknown', label: 'Action native' };
}

function detectIntentTarget(body: string): string | undefined {
  const ignored = /^(Landroid\/|Landroidx\/|Ljava\/|Lkotlin\/|Lcom\/google\/android\/gms\/|Ldalvik\/)/;
  const candidates = [
    ...Array.from(body.matchAll(/new-instance\s+v\d+,\s*(L[^;\s]+;)/g)).map((match) => match[1]),
    ...Array.from(body.matchAll(/const-class\s+v\d+,\s*(L[^;\s]+;)/g)).map((match) => match[1]),
  ];
  for (const candidate of candidates) {
    if (ignored.test(candidate)) continue;
    if (candidate.includes('$')) continue;
    if (/Intent|Bundle|Builder|Adapter|Listener|Runnable|Thread|String/.test(candidate)) continue;
    return candidate.replace(/^L/, '').replace(/;$/, '').replace(/\//g, '.');
  }
  return undefined;
}

function collectAssets(files: AnalysisFile[], kind: 'image' | 'sound' | 'font'): AssetEntry[] {
  return files
    .filter((file) => file.kind === kind)
    .slice(0, 500)
    .map((file) => ({ path: file.path, name: baseName(file.path), size: file.size }));
}

function detectEngines(files: AnalysisFile[]): EngineDetection[] {
  const paths = files.map((file) => file.path.toLowerCase());
  const rules: { key: string; label: string; evidence: RegExp; blocks: boolean }[] = [
    { key: 'unity', label: 'Unity', evidence: /(^|\/)libunity\.so$/, blocks: true },
    { key: 'unity-data', label: 'Unity', evidence: /^assets\/bin\/data\//, blocks: true },
    { key: 'unreal', label: 'Unreal Engine', evidence: /(^|\/)(libue4|libunreal)\.so$/, blocks: true },
    { key: 'cocos', label: 'Cocos2d-x', evidence: /(^|\/)(libcocos2d\w*|libcocosjs)\.so$/, blocks: true },
    { key: 'gdx', label: 'libGDX', evidence: /(^|\/)libgdx\.so$/, blocks: true },
    { key: 'godot', label: 'Godot', evidence: /(^|\/)libgodot\w*\.so$/, blocks: true },
    { key: 'gamemaker', label: 'GameMaker', evidence: /(^|\/)libyoyo\.so$/, blocks: true },
    { key: 'flutter', label: 'Flutter', evidence: /(^|\/)libflutter\.so$/, blocks: true },
    { key: 'react-native', label: 'React Native', evidence: /^assets\/index\.android\.bundle$/, blocks: true },
    {
      key: 'cordova',
      label: 'Cordova / application web embarquée',
      evidence: /^assets\/www\/index\.html$/,
      blocks: false,
    },
  ];
  const engines: EngineDetection[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    const hit = paths.find((path) => rule.evidence.test(path));
    if (!hit || seen.has(rule.key)) continue;
    seen.add(rule.key);
    engines.push({ key: rule.key, label: rule.label, evidence: hit, blocksGameplay: rule.blocks });
  }
  return engines;
}

function buildCapabilities(input: {
  layouts: number;
  screens: number;
  images: number;
  sounds: number;
  fonts: number;
  nativeLibs: number;
  clickBindings: number;
  convertedClicks: number;
  permissions: string[];
  engines: EngineDetection[];
  containerUsage: Map<string, number>;
  hasWebAssets: boolean;
}): Capability[] {
  const constrained =
    (input.containerUsage.get('ConstraintLayout') ?? 0) +
    (input.containerUsage.get('RelativeLayout') ?? 0) +
    (input.containerUsage.get('FrameLayout') ?? 0);

  const capabilities: Capability[] = [
    input.layouts > 0
      ? {
          key: 'layouts',
          label: 'Interfaces (layouts XML)',
          state: constrained > 0 ? 'partial' : 'ok',
          detail:
            constrained > 0
              ? `${input.layouts} layout(s) convertis en HTML/CSS. ${constrained} conteneur(s) à contraintes sont approximés par des flux flex (aucune mesure d'écran réelle, pas de rendu Android exact).`
              : `${input.layouts} layout(s) convertis en HTML/CSS à partir des attributs Android.`,
        }
      : {
          key: 'layouts',
          label: 'Interfaces (layouts XML)',
          state: 'unsupported',
          detail: 'Aucun layout XML exploitable : aucune interface Android ne peut être reconstruite.',
        },
    {
      key: 'resources',
      label: 'Ressources graphiques et sonores',
      state: input.images + input.sounds + input.fonts > 0 ? 'ok' : 'unsupported',
      detail:
        input.images + input.sounds + input.fonts > 0
          ? `${input.images} image(s), ${input.sounds} son(s), ${input.fonts} police(s) indexés et copiés dans l'export.`
          : 'Aucune ressource multimédia trouvée.',
    },
    {
      key: 'interactions',
      label: 'Interactions (onClick Smali)',
      state:
        input.clickBindings === 0
          ? 'unsupported'
          : input.convertedClicks >= input.clickBindings
            ? 'simulated'
            : 'partial',
      detail:
        input.clickBindings === 0
          ? 'Aucun gestionnaire de clic identifié : les éléments sont affichés sans comportement.'
          : `${input.convertedClicks}/${input.clickBindings} gestionnaire(s) traduits en actions web (navigation, retour, bascule, message, son). Le code Smali n'est jamais exécuté : les actions sont simulées.`,
    },
    {
      key: 'logic',
      label: 'Logique applicative (Dalvik/Smali)',
      state: 'unsupported',
      detail:
        "Le bytecode Dalvik ne peut pas s'exécuter dans un navigateur. Aucune règle métier, aucun calcul ni état interne de l'application n'est reproduit.",
    },
    {
      key: 'navigation',
      label: 'Navigation entre écrans',
      state: input.screens > 1 ? 'partial' : 'unsupported',
      detail:
        input.screens > 1
          ? `${input.screens} écrans reliés par un routeur web. Les intentions implicites, deep links et résultats d'activité ne sont pas reproduits.`
          : 'Un seul écran identifié : pas de navigation à reconstruire.',
    },
    {
      key: 'media',
      label: 'Lecture audio / vidéo',
      state: input.sounds > 0 ? 'partial' : 'unsupported',
      detail:
        input.sounds > 0
          ? "Les sons sont copiés et peuvent être déclenchés par les interactions identifiées ; la lecture pilotée par la logique Android n'est pas reproduite."
          : 'Aucun média détecté.',
    },
    {
      key: 'native',
      label: 'Bibliothèques natives (.so)',
      state: input.nativeLibs > 0 ? 'unsupported' : 'ok',
      detail:
        input.nativeLibs > 0
          ? `${input.nativeLibs} bibliothèque(s) native(s) détectée(s) : code machine Android, non exécutable dans un navigateur.`
          : 'Aucune bibliothèque native détectée.',
    },
  ];

  const blocking = input.engines.filter((engine) => engine.blocksGameplay);
  capabilities.push({
    key: 'engine',
    label: 'Moteur de jeu / framework binaire',
    state: blocking.length > 0 ? 'unsupported' : 'ok',
    detail:
      blocking.length > 0
        ? `${blocking.map((engine) => engine.label).join(', ')} détecté(s) : la mécanique de jeu ne peut pas être reconstruite. L'export contient les ressources et une interface statique, avec la liste des éléments manquants.`
        : 'Aucun moteur binaire bloquant détecté.',
  });

  capabilities.push({
    key: 'network',
    label: 'Réseau et services distants',
    state: input.permissions.includes('INTERNET') ? 'partial' : 'unsupported',
    detail: input.permissions.includes('INTERNET')
      ? "L'application demande l'accès Internet. Les appels API, l'authentification et la synchronisation ne sont pas rejoués : aucune requête n'est émise par le site généré."
      : "Aucun accès réseau déclaré : rien à reproduire.",
  });

  capabilities.push({
    key: 'persistence',
    label: 'État et persistance (SharedPreferences, SQLite)',
    state: 'unsupported',
    detail:
      "Les données internes de l'application ne sont pas lues ni réécrites. Le site généré est sans état (aucune donnée utilisateur stockée).",
  });

  capabilities.push({
    key: 'webassets',
    label: 'Ressources web embarquées',
    state: input.hasWebAssets ? 'partial' : 'unsupported',
    detail: input.hasWebAssets
      ? "Un dossier assets/www/index.html a été trouvé (application hybride) : il est inclus tel quel dans l'arborescence exportée."
      : 'Aucune application web embarquée dans assets/.',
  });

  return capabilities;
}
