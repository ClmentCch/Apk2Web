import {
  fontFamilyCss,
  resolveColorRef,
  resolveDimensionRef,
  resolveStringRef,
} from './android';
import { cssColor, cssDimension, escapeHtml, formatBytes, humanize, sanitizeName } from './files';
import type {
  Analysis,
  Capability,
  Diagnostic,
  Fidelity,
  InteractionSpec,
  ScreenSpec,
  ViewNode,
} from './types';

export interface BuildAsset {
  source: string;
  target: string;
  kind: 'image' | 'sound' | 'font' | 'web';
  name: string;
}

export interface GeneratedTextFile {
  path: string;
  mime: string;
  text: string;
}

export interface BuildScreen {
  id: string;
  title: string;
  layout: string;
  activity?: string;
}

export interface BuildResult {
  projectName: string;
  appLabel: string;
  packageName: string;
  createdAt: number;
  fidelity: Fidelity;
  fidelityLabel: string;
  screens: BuildScreen[];
  interactions: InteractionSpec[];
  capabilities: Capability[];
  diagnostics: Diagnostic[];
  files: GeneratedTextFile[];
  assets: BuildAsset[];
  usedAssets: string[];
  previewHtml: string;
  indexHtml: string;
  styleCss: string;
  scriptJs: string;
  assetBudgetExceeded: boolean;
}

export interface BuildInput {
  projectName: string;
  analysis: Analysis;
  files: { path: string; kind: string; size: number }[];
  edits?: Record<string, string>;
  readDataUrl?: (path: string, mime: string) => Promise<string | null>;
  inlineLimit?: number;
}

const CONTAINERS = new Set([
  'LinearLayout',
  'RelativeLayout',
  'FrameLayout',
  'ConstraintLayout',
  'CoordinatorLayout',
  'ScrollView',
  'HorizontalScrollView',
  'NestedScrollView',
  'GridLayout',
  'TableLayout',
  'TableRow',
  'CardView',
  'DrawerLayout',
  'AppBarLayout',
  'Toolbar',
  'ViewPager',
  'ViewPager2',
  'SwipeRefreshLayout',
  'ConstraintHelper',
  'MotionLayout',
  'BottomAppBar',
  'LinearLayoutCompat',
  'MaterialToolbar',
]);

const TEXTUAL = new Set(['TextView', 'TextClock', 'Chronometer', 'CheckedTextView']);

interface RenderContext {
  analysis: Analysis;
  screenId: string;
  interactions: Map<string, InteractionSpec>;
  assetTargets: Map<string, string>;
  used: Set<string>;
  missingDrawables: Set<string>;
  inlineWarnings: Set<string>;
  includeDepth: number;
}

export async function buildSite(input: BuildInput): Promise<BuildResult> {
  const analysis = input.analysis;
  const diagnostics: Diagnostic[] = [...analysis.diagnostics];
  const { assets, bySource, warnings: assetWarnings, budgetExceeded } = planAssets(
    analysis,
    input.files,
  );
  for (const warning of assetWarnings) {
    diagnostics.push({ level: 'warn', code: 'asset-budget', message: warning });
  }

  const interactions = new Map<string, InteractionSpec>();
  for (const interaction of analysis.interactions) {
    if (!interaction.viewId) continue;
    interactions.set(`${interaction.screenId}|${interaction.viewId}`, interaction);
  }

  const used = new Set<string>();
  const ctx: RenderContext = {
    analysis,
    screenId: '',
    interactions,
    assetTargets: bySource,
    used,
    missingDrawables: new Set(),
    inlineWarnings: new Set(),
    includeDepth: 0,
  };

  const screens: BuildScreen[] = analysis.screens.map((screen) => ({
    id: screen.id,
    title: screen.title,
    layout: screen.layout,
    activity: screen.activity,
  }));

  const secretInteractions = analysis.interactions.filter((interaction) => !interaction.viewId);
  if (secretInteractions.length > 0) {
    diagnostics.push({
      level: 'warn',
      code: 'interactions-unbound',
      message: `${secretInteractions.length} action(s) détectée(s) sans vue identifiable : elles ne peuvent pas être rattachées à un élément HTML.`,
      detail: secretInteractions
        .slice(0, 8)
        .map((interaction) => `${interaction.handler} — ${interaction.label}`)
        .join(' · '),
    });
  }

  let body: string;
  const galleryOnly = analysis.screens.length === 0;
  if (galleryOnly) {
    body = renderGallery(ctx);
  } else {
    body = analysis.screens
      .map((screen, index) => {
        ctx.screenId = screen.id;
        return renderScreen(screen, ctx, index === 0);
      })
      .join('\n');
  }

  if (ctx.missingDrawables.size > 0) {
    diagnostics.push({
      level: 'warn',
      code: 'drawables-missing',
      message: `${ctx.missingDrawables.size} ressource(s) graphique(s) référencée(s) mais absente(s) : des blocs à damier sont affichés à leur place.`,
      detail: [...ctx.missingDrawables].slice(0, 15).join(', '),
    });
  }

  const fidelity = computeFidelity(analysis, galleryOnly);
  const appTitle = analysis.appLabel || input.projectName;

  const dataModule = buildDataModule(analysis, input.projectName, fidelity, screens);
  const routerModule = ROUTER_MODULE;
  const interactionsModule = INTERACTIONS_MODULE;
  const styleCss = buildStyleCss(analysis);
  const scriptJs = buildBootstrap(screens.length > 0);
  const chrome = buildChrome(screens, galleryOnly);
  const indexHtml = buildIndexHtml(appTitle, body, chrome, galleryOnly);
  const readme = buildReadme(analysis, screens, fidelity, diagnostics, assets, used, input);
  const htaccess = HTACCESS;

  const modules: Record<string, string> = {
    'src/modules/data.js': dataModule,
    'src/modules/router.js': routerModule,
    'src/modules/interactions.js': interactionsModule,
  };

  const baseFiles: GeneratedTextFile[] = [
    { path: 'index.html', mime: 'text/html', text: indexHtml },
    { path: 'style.css', mime: 'text/css', text: styleCss },
    { path: 'script.js', mime: 'text/javascript', text: scriptJs },
    ...Object.entries(modules).map(([path, text]) => ({
      path,
      mime: 'text/javascript',
      text,
    })),
    { path: 'README.md', mime: 'text/markdown', text: readme },
    { path: '.htaccess', mime: 'text/plain', text: htaccess },
  ];

  const files = applyEdits(baseFiles, input.edits ?? {});
  const finalIndex = files.find((file) => file.path === 'index.html')?.text ?? indexHtml;
  const finalCss = files.find((file) => file.path === 'style.css')?.text ?? styleCss;

  const previewHtml = await composePreview({
    indexHtml: finalIndex,
    css: finalCss,
    modules: Object.fromEntries(
      files
        .filter((file) => file.path.startsWith('src/modules/'))
        .map((file) => [file.path, file.text]),
    ),
    script: files.find((file) => file.path === 'script.js')?.text ?? scriptJs,
    used,
    assets,
    readDataUrl: input.readDataUrl,
    inlineLimit: input.inlineLimit ?? 26 * 1024 * 1024,
    hasScreens: !galleryOnly,
  });

  return {
    projectName: input.projectName,
    appLabel: appTitle,
    packageName: analysis.packageName,
    createdAt: Date.now(),
    fidelity: fidelity.fidelity,
    fidelityLabel: fidelity.label,
    screens,
    interactions: analysis.interactions,
    capabilities: analysis.capabilities,
    diagnostics,
    files,
    assets,
    usedAssets: [...used],
    previewHtml,
    indexHtml: finalIndex,
    styleCss: finalCss,
    scriptJs,
    assetBudgetExceeded: budgetExceeded,
  };
}

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

interface AssetPlan {
  assets: BuildAsset[];
  bySource: Map<string, string>;
  warnings: string[];
  budgetExceeded: boolean;
}

function planAssets(
  analysis: Analysis,
  files: { path: string; kind: string; size: number }[],
): AssetPlan {
  const assets: BuildAsset[] = [];
  const bySource = new Map<string, string>();
  const targets = new Set<string>();
  const warnings: string[] = [];
  let budgetExceeded = false;

  const limits = { image: 110 * 1024 * 1024, sound: 40 * 1024 * 1024, font: 20 * 1024 * 1024 };
  const totals = { image: 0, sound: 0, font: 0 };

  const byPath = new Map(files.map((file) => [file.path, file]));

  const add = (source: string, kind: BuildAsset['kind'], preferredName?: string): void => {
    if (bySource.has(source)) return;
    const file = byPath.get(source);
    if (!file) return;
    if (kind !== 'web') {
      if (totals[kind] + file.size > limits[kind]) {
        budgetExceeded = true;
        return;
      }
      totals[kind] += file.size;
    }
    const name = sanitizeName(preferredName ?? file.path.slice(file.path.lastIndexOf('/') + 1)) || 'asset';
    const folder = kind === 'image' ? 'images' : kind === 'sound' ? 'sounds' : kind === 'font' ? 'fonts' : '';
    let target = kind === 'web' ? source : `assets/${folder}/${name}`;
    let counter = 2;
    while (targets.has(target)) {
      const dot = name.lastIndexOf('.');
      const variant = dot > 0 ? `${name.slice(0, dot)}-${counter}${name.slice(dot)}` : `${name}-${counter}`;
      target = kind === 'web' ? source : `assets/${folder}/${variant}`;
      counter += 1;
    }
    targets.add(target);
    bySource.set(source, target);
    assets.push({ source, target, kind, name });
  };

  // Drawables referenced by name use the density-selected source.
  for (const ref of Object.values(analysis.drawables)) {
    if (ref.kind === 'image' && ref.path) add(ref.path, 'image');
  }
  for (const image of analysis.images) add(image.path, 'image');
  for (const sound of analysis.sounds) add(sound.path, 'sound');
  for (const font of analysis.fonts) add(font.path, 'font');
  for (const file of files) {
    if (/^assets\/www\//i.test(file.path)) add(file.path, 'web');
  }

  if (budgetExceeded) {
    warnings.push(
      "Le budget d'export des ressources (110 Mo images / 40 Mo sons / 20 Mo polices) a été dépassé : les fichiers les plus volumineux ne sont pas inclus.",
    );
  }

  return { assets, bySource, warnings, budgetExceeded };
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/\n/g, ' ');
}

function renderScreen(screen: ScreenSpec, ctx: RenderContext, visible: boolean): string {
  const content = renderNode(screen.root, ctx, undefined, true);
  return `<section class="a2w-screen" id="${screen.id}" data-screen-id="${screen.id}" aria-label="${escapeAttr(
    screen.title,
  )}"${visible ? '' : ' hidden'}>
${content}
</section>`;
}

function renderNode(node: ViewNode, ctx: RenderContext, parent: ViewNode | undefined, isRoot = false): string {
  ctx.includeDepth += 1;
  try {
    if (ctx.includeDepth > 6) return '';
    if (node.tag === 'include') {
      const included = node.include ? ctx.analysis.layoutMap?.[node.include] : undefined;
      if (!included) {
        if (node.include) recordMissing(ctx, `layout:${node.include}`);
        return '';
      }
      return renderNode(included, ctx, parent, isRoot);
    }
    if (node.tag === 'merge') {
      return node.children.map((child) => renderNode(child, ctx, parent)).join('\n');
    }

    const tag = node.tag;
    const decls = styleDecls(node, ctx, isRoot);
    const attrs: string[] = [];
    const className = ['a2w-view'];
    const interaction = node.id ? ctx.interactions.get(`${ctx.screenId}|${node.id}`) : undefined;

    if (isRoot) {
      className.push('a2w-screen-root');
      if (!node.attrs.background) decls.push('background:#ffffff');
    }
    if (node.id) attrs.push(`data-a2w-id="${escapeAttr(node.id)}"`);
    if (interaction && interaction.converted) {
      attrs.push(...interactionAttrs(interaction, ctx));
      decls.push('cursor:pointer');
      className.push('a2w-interactive');
    }

    const styleAttr = decls.length > 0 ? ` style="${escapeAttr(decls.join(';'))}"` : '';
    const common = `${attrs.length > 0 ? ` ${attrs.join(' ')}` : ''}${styleAttr}`;

    /* ---------------------------------------------------------- */
    /* Widgets                                                     */
    /* ---------------------------------------------------------- */
    if (TEXTUAL.has(tag)) {
      const text = nodeText(node, ctx);
      className.push('a2w-text');
      return `<div class="${className.join(' ')}"${common}>${text || '&nbsp;'}</div>`;
    }

    switch (tag) {
      case 'Button':
      case 'MaterialButton':
      case 'AppCompatButton':
      case 'ImageButton': {
        const text = nodeText(node, ctx) || (tag === 'ImageButton' ? '' : '&nbsp;');
        className.push('a2w-button');
        const image = tag === 'ImageButton' ? imageFor(node.attrs.src, ctx, node) : undefined;
        const inner = image ? `<img src="${escapeAttr(image.target)}" alt="" />` : text;
        return `<button type="button" class="${className.join(' ')}"${common} aria-label="${escapeAttr(
          node.attrs.contentDescription || stripTags(text) || node.id || 'Bouton',
        )}">${inner}</button>`;
      }
      case 'EditText':
      case 'TextInputEditText':
      case 'AutoCompleteTextView':
      case 'SearchView': {
        className.push('a2w-input');
        const hint = resolveStringRef(node.attrs.hint, ctx.analysis.strings) ?? '';
        const type = inputType(node.attrs.inputType);
        return `<input class="${className.join(' ')}" type="${type}" placeholder="${escapeAttr(
          hint,
        )}" aria-label="${escapeAttr(hint || node.id || 'Champ de saisie')}"${common} />`;
      }
      case 'CheckBox':
      case 'RadioButton':
      case 'Switch':
      case 'SwitchCompat':
      case 'ToggleButton':
      case 'MaterialSwitch':
      case 'CheckedTextView': {
        className.push('a2w-choice');
        const checked = node.attrs.checked === 'true' ? ' checked' : '';
        const text = nodeText(node, ctx);
        return `<label class="${className.join(' ')}"${common}><input type="checkbox"${checked} /><span>${text}</span></label>`;
      }
      case 'SeekBar':
      case 'RatingBar': {
        className.push('a2w-range');
        const min = Number(node.attrs.min) || 0;
        const max = Number(node.attrs.max) || 100;
        const value = Number(node.attrs.progress) || 0;
        return `<input class="${className.join(' ')}" type="range" min="${min}" max="${
          max > min ? max : min + 100
        }" value="${value}" aria-label="Curseur"${common} />`;
      }
      case 'ProgressBar': {
        className.push('a2w-progress');
        const max = Number(node.attrs.max) || 100;
        const value = Number(node.attrs.progress) || 0;
        const pct = Math.max(0, Math.min(100, (value / max) * 100));
        const indeterminate = node.attrs.indeterminate === 'true' || (!node.attrs.progress && !node.attrs.max);
        return `<div class="${className.join(' ')}${indeterminate ? ' a2w-progress--indeterminate' : ''}" role="progressbar" aria-valuenow="${value}"${common}><span style="width:${pct}%"></span></div>`;
      }
      case 'ImageView':
      case 'AppCompatImageView':
      case 'CircleImageView':
      case 'ShapeableImageView': {
        className.push('a2w-image');
        const img = imageFor(node.attrs.src, ctx, node);
        const alt = node.attrs.contentDescription || node.id || '';
        if (img) {
          return `<img class="${className.join(' ')}" src="${escapeAttr(
            img.target,
          )}" alt="${escapeAttr(alt)}" loading="lazy"${common} />`;
        }
        return `<div class="${className.join(' ')} a2w-image--missing" aria-label="${escapeAttr(
          alt || 'Image',
        )}"${common}>${escapeHtml(alt || 'Image manquante')}</div>`;
      }
      case 'Spinner':
      case 'AppCompatSpinner':
      case 'MaterialSpinner': {
        className.push('a2w-select');
        const options = entriesFor(node, ctx);
        const items = options.length > 0 ? options : ['Sélection 1', 'Sélection 2'];
        return `<select class="${className.join(' ')}" aria-label="Liste déroulante"${common}>${items
          .map((item, index) => `<option value="${index}">${escapeHtml(item)}</option>`)
          .join('')}</select>`;
      }
      case 'ListView':
      case 'RecyclerView':
      case 'GridView':
      case 'ExpandableListView':
      case 'ListFragment': {
        className.push('a2w-list');
        const items = entriesFor(node, ctx);
        const list = items.length > 0 ? items : ['Élément 1', 'Élément 2', 'Élément 3'];
        const grid = tag === 'GridView' ? ' a2w-list--grid' : '';
        return `<div class="${className.join(' ')}${grid}" data-a2w-list${common}>${list
          .slice(0, 24)
          .map(
            (item) =>
              `<div class="a2w-list-item"><span>${escapeHtml(item)}</span><span class="a2w-chevron">›</span></div>`,
          )
          .join('')}${items.length === 0 ? '<div class="a2w-note a2w-note--inline">Contenu de liste chargé dynamiquement dans Android : éléments d’exemple.</div>' : ''}</div>`;
      }
      case 'WebView': {
        className.push('a2w-webview');
        const src = node.attrs.src;
        if (src && /^https?:/i.test(src)) {
          return `<iframe class="${className.join(' ')}" src="${escapeAttr(src)}" title="WebView"${common}></iframe>`;
        }
        return `<div class="${className.join(' ')}"${common}><strong>WebView</strong><span>Contenu chargé dynamiquement par l’application — non reconstruit.</span></div>`;
      }
      case 'SurfaceView':
      case 'GLSurfaceView':
      case 'TextureView':
      case 'VideoView': {
        className.push(tag === 'VideoView' ? 'a2w-video' : 'a2w-surface');
        return `<div class="${className.join(' ')}"${common}><strong>${tag}</strong><span>${
          tag === 'VideoView' ? 'Vidéo non rejouée dans la reconstruction.' : 'Rendu OpenGL / caméra non reconstruit.'
        }</span></div>`;
      }
      case 'FloatingActionButton':
      case 'ExtendedFloatingActionButton': {
        className.push('a2w-fab');
        const img = imageFor(node.attrs.src, ctx, node);
        return `<button type="button" class="${className.join(' ')}" aria-label="${escapeAttr(
          node.attrs.contentDescription || 'Action',
        )}"${common}>${img ? `<img src="${escapeAttr(img.target)}" alt="" />` : '＋'}</button>`;
      }
      case 'TabLayout': {
        className.push('a2w-tabs');
        const tabs = node.children
          .filter((child) => /TabItem/.test(child.tag))
          .map((child) => resolveStringRef(child.attrs.text, ctx.analysis.strings) ?? 'Onglet');
        return `<div class="${className.join(' ')}"${common}>${(tabs.length > 0 ? tabs : ['Onglet 1', 'Onglet 2'])
          .map((tab) => `<span class="a2w-tab">${escapeHtml(tab)}</span>`)
          .join('')}</div>`;
      }
      case 'Space': {
        return `<div class="a2w-space"${common}></div>`;
      }
      case 'View':
      case 'ViewStub': {
        return `<div class="${className.join(' ')}"${common}>${node.children
          .map((child) => renderNode(child, ctx, node))
          .join('')}</div>`;
      }
      case 'fragment':
      case 'FragmentContainerView':
      case 'NavHostFragment': {
        className.push('a2w-fragment');
        return `<div class="${className.join(' ')}"${common}><strong>${escapeHtml(tag)}</strong><span>Fragment ${
          node.attrs.name ? escapeHtml(node.attrs.name) : ''
        } — contenu géré par la logique Android, non reconstruit.</span></div>`;
      }
      default:
        break;
    }

    /* ---------------------------------------------------------- */
    /* Containers and unknown tags                                 */
    /* ---------------------------------------------------------- */
    const isContainer = CONTAINERS.has(tag) || node.children.length > 0;
    className.push('a2w-container');
    className.push(`a2w-${cssClass(tag)}`);
    if (!isContainer) {
      return `<div class="${className.join(' ')}"${common}></div>`;
    }
    const children = node.children
      .map((child) => renderNode(child, ctx, node))
      .join('\n');
    return `<div class="${className.join(' ')}"${common}>${children}</div>`;
  } finally {
    ctx.includeDepth -= 1;
  }
}

function interactionAttrs(interaction: InteractionSpec, ctx: RenderContext): string[] {
  const attrs = [
    `data-a2w-action="${interaction.action}"`,
    `data-a2w-label="${escapeAttr(interaction.label)}"`,
    `data-a2w-handler="${escapeAttr(interaction.handler)}"`,
  ];
  if (interaction.target) attrs.push(`data-a2w-target="${interaction.target}"`);
  if (interaction.action === 'sound') {
    const sound = ctx.analysis.sounds[0];
    const target = sound ? ctx.assetTargets.get(sound.path) : undefined;
    if (target) {
      attrs.push(`data-a2w-sound="${target}"`);
      ctx.used.add(target);
    }
  }
  return attrs;
}

function imageFor(
  value: string | undefined,
  ctx: RenderContext,
  node: ViewNode,
): { target: string; source: string } | undefined {
  if (!value) return undefined;
  const name = drawableName(value);
  if (!name) return undefined;
  const ref = ctx.analysis.drawables[name];
  if (!ref) {
    recordMissing(ctx, name);
    return undefined;
  }
  if (ref.kind === 'image' && ref.path) {
    const target = ctx.assetTargets.get(ref.path);
    if (!target) {
      recordMissing(ctx, name);
      return undefined;
    }
    ctx.used.add(target);
    return { target, source: ref.path };
  }
  if (ref.kind === 'shape' && ref.shape) {
    const decls = shapeDecls(ref.shape, ctx);
    if (decls.length > 0) node.attrs.__shape = decls.join(';');
    return undefined;
  }
  recordMissing(ctx, name);
  return undefined;
}

function drawableName(value: string): string | undefined {
  const raw = value.trim();
  if (raw.startsWith('@drawable/')) return raw.slice('@drawable/'.length);
  if (raw.startsWith('@mipmap/')) return raw.slice('@mipmap/'.length);
  if (raw.startsWith('@android:drawable/')) return undefined;
  return undefined;
}

function recordMissing(ctx: RenderContext, name: string): void {
  if (ctx.missingDrawables.size >= 60) return;
  ctx.missingDrawables.add(name);
}

function nodeText(node: ViewNode, ctx: RenderContext): string {
  const raw = node.attrs.text;
  if (raw === undefined) return '';
  const resolved = resolveStringRef(raw, ctx.analysis.strings);
  if (resolved === undefined) {
    if (raw.startsWith('@')) {
      return `<span class="a2w-unresolved">${escapeHtml(humanize(node.id ?? raw.replace(/^@[^/]+\//, '')))}</span>`;
    }
    return '';
  }
  const text = resolved.replace(/%\d+\$?[sd]/g, '…');
  return escapeHtml(text).replace(/\n/g, '<br />');
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function inputType(value: string | undefined): string {
  if (!value) return 'text';
  const raw = value.toLowerCase();
  if (/phone/.test(raw)) return 'tel';
  if (/number|numeric|decimal/.test(raw)) return 'number';
  if (/password/.test(raw)) return 'password';
  if (/email/.test(raw)) return 'email';
  if (/uri/.test(raw)) return 'url';
  return 'text';
}

function entriesFor(node: ViewNode, ctx: RenderContext): string[] {
  const raw = node.attrs.entries;
  if (!raw || !raw.startsWith('@array/')) return [];
  return ctx.analysis.arrays[raw.slice('@array/'.length)] ?? [];
}

function cssClass(tag: string): string {
  return tag
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .toLowerCase();
}

function styleDecls(node: ViewNode, ctx: RenderContext, isRoot = false): string[] {
  const decls: string[] = [];
  const attrs = node.attrs;
  const tag = node.tag;
  const a = ctx.analysis;

  if (CONTAINERS.has(tag) || node.children.length > 0 || tag === 'ScrollView' || tag === 'NestedScrollView') {
    if (tag === 'ScrollView' || tag === 'NestedScrollView' || tag === 'HorizontalScrollView') {
      decls.push('display:block', 'overflow:auto', '-webkit-overflow-scrolling:touch', 'flex:1 1 auto');
    } else {
      const horizontal = (attrs.orientation ?? '').toLowerCase() === 'horizontal';
      decls.push('display:flex', `flex-direction:${horizontal ? 'row' : 'column'}`, 'flex-shrink:0', 'position:relative');
      if (tag === 'GridView') decls.push('flex-wrap:wrap');
      if (tag === 'TableLayout') decls.push('width:100%');
    }
  }

  const width = resolveDimensionValue(attrs.layout_width, a.dimens);
  const height = resolveDimensionValue(attrs.layout_height, a.dimens);
  const weight = Number(attrs.layout_weight);

  const zeroWidth = attrs.layout_width === '0dp' || attrs.layout_width === '0dip' || attrs.layout_width === '0px';
  const zeroHeight = attrs.layout_height === '0dp' || attrs.layout_height === '0dip' || attrs.layout_height === '0px';
  if (isRoot) {
    decls.push('width:100%', 'min-height:100vh');
    if (height && height !== '100%' && height !== 'auto') decls.push(`height:${height}`);
  } else if (Number.isFinite(weight) && weight > 0 && (zeroWidth || zeroHeight)) {
    decls.push(`flex:${weight} 1 0%`);
  } else if (width === 'auto') {
    decls.push('width:auto', 'align-self:flex-start');
  } else if (width) {
    decls.push(`width:${width}`);
  }
  if (height && !isRoot) decls.push(`height:${height}`);
  else if (!height && tag === 'ScrollView') decls.push('height:auto');

  // margins and padding
  const margin = resolveDimensionValue(attrs.layout_margin, a.dimens);
  if (margin) decls.push(`margin:${margin}`);
  for (const side of ['Left', 'Right', 'Top', 'Bottom', 'Start', 'End', 'Horizontal', 'Vertical'] as const) {
    const key = side.toLowerCase();
    const value =
      resolveDimensionValue(attrs[`layout_margin${side}`], a.dimens) ??
      resolveDimensionValue(attrs[`layout_margin${key}`], a.dimens);
    if (!value) continue;
    if (side === 'Horizontal') decls.push(`margin-left:${value}`, `margin-right:${value}`);
    else if (side === 'Vertical') decls.push(`margin-top:${value}`, `margin-bottom:${value}`);
    else if (side === 'Start') decls.push(`margin-left:${value}`);
    else if (side === 'End') decls.push(`margin-right:${value}`);
    else decls.push(`margin-${key}:${value}`);
  }

  const padding = resolveDimensionValue(attrs.padding, a.dimens);
  if (padding) decls.push(`padding:${padding}`);
  for (const side of ['Left', 'Right', 'Top', 'Bottom', 'Start', 'End', 'Horizontal', 'Vertical'] as const) {
    const value =
      resolveDimensionValue(attrs[`padding${side}`], a.dimens) ??
      resolveDimensionValue(attrs[`padding${side.toLowerCase()}`], a.dimens);
    if (!value) continue;
    if (side === 'Horizontal') decls.push(`padding-left:${value}`, `padding-right:${value}`);
    else if (side === 'Vertical') decls.push(`padding-top:${value}`, `padding-bottom:${value}`);
    else if (side === 'Start') decls.push(`padding-left:${value}`);
    else if (side === 'End') decls.push(`padding-right:${value}`);
    else decls.push(`padding-${side.toLowerCase()}:${value}`);
  }

  // background
  if (attrs.background) {
    decls.push(...backgroundDecls(attrs.background, ctx));
  }
  const isButton =
    tag === 'Button' ||
    tag === 'MaterialButton' ||
    tag === 'AppCompatButton' ||
    tag === 'ImageButton' ||
    tag === 'FloatingActionButton' ||
    tag === 'ExtendedFloatingActionButton';
  if (isButton && !attrs.textColor) {
    const solid = solidColorOf(attrs.background, ctx);
    if (solid) decls.push(`color:${readableTextColor(solid)}`);
  }
  if (attrs.backgroundTint) {
    const color = resolveColorRef(attrs.backgroundTint, a.colors);
    if (color) decls.push(`background-color:${color}`);
  }

  // visibility / alpha / elevation
  if (attrs.visibility === 'gone') decls.push('display:none');
  else if (attrs.visibility === 'invisible') decls.push('visibility:hidden');
  if (attrs.alpha) decls.push(`opacity:${attrs.alpha}`);
  if (attrs.elevation) {
    const value = resolveDimensionValue(attrs.elevation, a.dimens) ?? '2px';
    const n = parseFloat(value) || 2;
    decls.push(`box-shadow:0 ${Math.min(n, 16)}px ${Math.min(n * 2, 32)}px rgba(0,0,0,.16)`);
  }

  // text
  if (TEXTUAL.has(tag) || tag === 'Button' || tag === 'MaterialButton' || tag === 'AppCompatButton' || tag === 'EditText' || tag === 'CheckBox' || tag === 'RadioButton' || tag === 'Switch' || tag === 'ToggleButton') {
    const size = resolveDimensionValue(attrs.textSize, a.dimens);
    decls.push(`font-size:${size ?? '14px'}`);
    const color = resolveColorRef(attrs.textColor, a.colors);
    if (color) decls.push(`color:${color}`);
    const font = fontFamilyCss(attrs.fontFamily);
    if (font.family) decls.push(`font-family:${font.family}`);
    if (font.weight) decls.push(`font-weight:${font.weight}`);
    if (attrs.scaleType) {
      const fit: Record<string, string> = {
        centerCrop: 'cover',
        fitCenter: 'contain',
        fitXY: 'fill',
        centerInside: 'scale-down',
        center: 'none',
      };
      decls.push(`object-fit:${fit[attrs.scaleType] ?? 'contain'}`);
    }
    if (attrs.textStyle) {
      if (/bold/.test(attrs.textStyle)) decls.push('font-weight:700');
      if (/italic/.test(attrs.textStyle)) decls.push('font-style:italic');
    }
    if (attrs.textAllCaps === 'true') decls.push('text-transform:uppercase');
    if (attrs.letterSpacing) decls.push(`letter-spacing:${attrs.letterSpacing}em`);
    if (attrs.maxLines && attrs.ellipsize) {
      decls.push('overflow:hidden', 'text-overflow:ellipsis');
      if (Number(attrs.maxLines) === 1) decls.push('white-space:nowrap');
      else {
        decls.push('display:-webkit-box', `-webkit-line-clamp:${attrs.maxLines}`, '-webkit-box-orient:vertical');
      }
    } else if (attrs.singleLine === 'true') {
      decls.push('white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis');
    }
    const gravity = attrs.gravity;
    if (gravity) {
      if (/center|center_horizontal/.test(gravity)) decls.push('text-align:center');
      else if (/end|right/.test(gravity)) decls.push('text-align:right');
      if (/center_vertical|center/.test(gravity)) decls.push('justify-content:center');
    }
  }

  // container gravity
  if (CONTAINERS.has(tag) && attrs.gravity) {
    const gravity = attrs.gravity;
    const horizontal = (attrs.orientation ?? '').toLowerCase() === 'horizontal';
    if (/center_horizontal|center/.test(gravity)) {
      decls.push(horizontal ? 'justify-content:center' : 'align-items:center');
    }
    if (/center_vertical|center/.test(gravity)) {
      decls.push(horizontal ? 'align-items:center' : 'justify-content:center');
    }
    if (/end|right/.test(gravity) && !/center/.test(gravity)) {
      decls.push(horizontal ? 'justify-content:flex-end' : 'align-items:flex-end');
    }
    if (/bottom/.test(gravity) && !/center/.test(gravity)) {
      decls.push(horizontal ? 'align-items:flex-end' : 'justify-content:flex-end');
    }
  }

  // simple relative / constraint approximations
  if (attrs.layout_centerInParent === 'true') {
    decls.push('position:absolute', 'top:50%', 'left:50%', 'transform:translate(-50%,-50%)');
  } else if (attrs.layout_alignParentBottom === 'true') {
    decls.push('margin-top:auto');
  }
  if (attrs.layout_alignParentRight === 'true' || attrs.layout_alignParentEnd === 'true') {
    decls.push('align-self:flex-end');
  }
  const layoutGravity = attrs.layout_gravity;
  if (layoutGravity) {
    if (/center_horizontal|center/.test(layoutGravity)) decls.push('align-self:center');
    else if (/end|right/.test(layoutGravity)) decls.push('align-self:flex-end');
  }

  if (attrs.__shape) decls.push(attrs.__shape);
  if (attrs.foreground) {
    const fg = resolveColorRef(attrs.foreground, a.colors);
    if (fg) decls.push(`color:${fg}`);
  }

  return decls;
}

function solidColorOf(value: string | undefined, ctx: RenderContext): string | undefined {
  if (!value) return undefined;
  const raw = value.trim();
  if (raw.startsWith('@color/')) return resolveColorRef(raw, ctx.analysis.colors);
  if (raw.startsWith('@android:color/')) return resolveColorRef(raw, ctx.analysis.colors);
  if (raw.startsWith('@drawable/') || raw.startsWith('@mipmap/')) {
    const name = raw.slice(raw.indexOf('/') + 1);
    const ref = ctx.analysis.drawables[name];
    const color = ref?.shape?.solid ?? ref?.shape?.gradientColors?.[0];
    return color ? resolveColorRef(color, ctx.analysis.colors) ?? color : undefined;
  }
  if (raw.startsWith('#')) return raw;
  return undefined;
}

function readableTextColor(color: string): string {
  let red = 0;
  let green = 0;
  let blue = 0;
  const hex = /^#([0-9a-f]{3,8})$/i.exec(color.trim());
  if (hex) {
    const value = hex[1];
    if (value.length === 3) {
      red = parseInt(value[0] + value[0], 16);
      green = parseInt(value[1] + value[1], 16);
      blue = parseInt(value[2] + value[2], 16);
    } else if (value.length === 6 || value.length === 8) {
      const start = value.length === 8 ? 2 : 0;
      red = parseInt(value.slice(start, start + 2), 16);
      green = parseInt(value.slice(start + 2, start + 4), 16);
      blue = parseInt(value.slice(start + 4, start + 6), 16);
    }
  } else {
    const rgba = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(color);
    if (rgba) {
      red = Number(rgba[1]);
      green = Number(rgba[2]);
      blue = Number(rgba[3]);
    } else {
      return '#ffffff';
    }
  }
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.62 ? '#14161c' : '#ffffff';
}

function resolveDimensionValue(value: string | undefined, dimens: Record<string, string>): string | undefined {
  if (!value) return undefined;
  const resolved = resolveDimensionRef(value, dimens) ?? value;
  return cssDimension(resolved);
}

function backgroundDecls(value: string, ctx: RenderContext): string[] {
  const raw = value.trim();
  if (!raw || raw === '@null') return [];
  if (raw.startsWith('@color/') || raw.startsWith('@android:color/')) {
    const color = resolveColorRef(raw, ctx.analysis.colors);
    return color ? [`background-color:${color}`] : [];
  }
  if (raw.startsWith('@drawable/') || raw.startsWith('@mipmap/')) {
    const name = raw.slice(raw.indexOf('/') + 1);
    const ref = ctx.analysis.drawables[name];
    if (!ref) {
      recordMissing(ctx, name);
      return [];
    }
    if (ref.kind === 'image' && ref.path) {
      const target = ctx.assetTargets.get(ref.path);
      if (!target) {
        recordMissing(ctx, name);
        return [];
      }
      ctx.used.add(target);
      return [
        `background-image:url('${target}')`,
        'background-size:cover',
        'background-position:center',
        'background-repeat:no-repeat',
      ];
    }
    if (ref.kind === 'shape' && ref.shape) {
      return shapeDecls(ref.shape, ctx);
    }
    recordMissing(ctx, name);
    return [];
  }
  if (raw.startsWith('@')) return [];
  const color = cssColor(raw);
  return color ? [`background-color:${color}`] : [];
}

function shapeDecls(shape: NonNullable<Analysis['drawables'][string]['shape']>, ctx: RenderContext): string[] {
  const decls: string[] = [];
  if (shape.gradientColors && shape.gradientColors.length > 0) {
    const colors = shape.gradientColors.map((color) => resolveColorRef(color, ctx.analysis.colors) ?? color);
    const angle = Number(shape.gradientDirection);
    const cssAngle = Number.isFinite(angle) ? 90 - angle : 180;
    decls.push(`background:linear-gradient(${cssAngle}deg, ${colors.join(', ')})`);
  } else if (shape.solid) {
    const color = resolveColorRef(shape.solid, ctx.analysis.colors) ?? shape.solid;
    decls.push(`background-color:${color}`);
  }
  if (shape.cornerRadius) decls.push(`border-radius:${shape.cornerRadius}px`);
  if (shape.strokeWidth && shape.strokeColor) {
    const color = resolveColorRef(shape.strokeColor, ctx.analysis.colors) ?? shape.strokeColor;
    decls.push(`border:${shape.strokeWidth}px solid ${color}`);
  }
  return decls;
}

/* ------------------------------------------------------------------ */
/* Gallery (no layouts)                                                */
/* ------------------------------------------------------------------ */

function renderGallery(ctx: RenderContext): string {
  const analysis = ctx.analysis;
  const images = analysis.images.slice(0, 120);
  const sounds = analysis.sounds.slice(0, 40);
  const fonts = analysis.fonts.slice(0, 20);
  const imageCards = images
    .map((image) => {
      const target = ctx.assetTargets.get(image.path);
      if (!target) return '';
      ctx.used.add(target);
      return `<figure class="a2w-gallery-item"><img src="${escapeAttr(target)}" alt="${escapeAttr(
        image.name,
      )}" loading="lazy" /><figcaption>${escapeHtml(image.name)}</figcaption></figure>`;
    })
    .filter(Boolean)
    .join('');
  const soundRows = sounds
    .map((sound) => {
      const target = ctx.assetTargets.get(sound.path);
      if (!target) return '';
      ctx.used.add(target);
      return `<div class="a2w-gallery-sound"><span>${escapeHtml(sound.name)}</span><audio controls preload="none" src="${escapeAttr(
        target,
      )}"></audio></div>`;
    })
    .filter(Boolean)
    .join('');
  const fontRows = fonts
    .map((font) => `<li>${escapeHtml(font.name)} <span>${formatBytes(font.size)}</span></li>`)
    .join('');

  return `<section class="a2w-screen" id="assets" data-screen-id="assets" aria-label="Ressources">
<div class="a2w-screen-root a2w-gallery">
  <header class="a2w-gallery-head">
    <h1>${escapeHtml(analysis.appLabel)}</h1>
    <p>Conversion partielle : aucun layout XML exploitable. Voici les ressources extraites de l'application. L'interface et la logique Android n'ont pas pu être reconstruites.</p>
  </header>
  <h2>Images <span>${analysis.images.length}</span></h2>
  <div class="a2w-gallery-grid">${imageCards || '<p class="a2w-note">Aucune image.</p>'}</div>
  <h2>Sons <span>${analysis.sounds.length}</span></h2>
  ${soundRows || '<p class="a2w-note">Aucun son.</p>'}
  <h2>Polices <span>${analysis.fonts.length}</span></h2>
  ${fontRows ? `<ul class="a2w-gallery-fonts">${fontRows}</ul>` : '<p class="a2w-note">Aucune police.</p>'}
  <footer class="a2w-gallery-foot">Reconstruit avec APK2WEB — aucune logique Android n'est exécutée.</footer>
</div>
</section>`;
}

/* ------------------------------------------------------------------ */
/* Fidelity / capabilities                                             */
/* ------------------------------------------------------------------ */

function computeFidelity(
  analysis: Analysis,
  galleryOnly: boolean,
): { fidelity: Fidelity; label: string } {
  if (galleryOnly) {
    return {
      fidelity: 'assets',
      label: 'Ressources seulement — interface non reconstruite',
    };
  }
  const totalClicks = analysis.capabilities.find((capability) => capability.key === 'interactions');
  const blocking = analysis.engines.filter((engine) => engine.blocksGameplay);
  const converted = analysis.interactions.filter((interaction) => interaction.converted).length;
  const bound = analysis.interactions.filter((interaction) => interaction.viewId).length;
  if (blocking.length > 0) {
    return {
      fidelity: 'interface',
      label: `Interface reconstruite — ${blocking[0].label} non reproduit`,
    };
  }
  if (totalClicks?.state === 'simulated' && bound > 0 && converted === bound) {
    return {
      fidelity: 'interactive',
      label: 'Interface + interactions identifiées (simulées, code Android non exécuté)',
    };
  }
  if (converted > 0) {
    return {
      fidelity: 'interface',
      label: 'Interface reconstruite — interactions partiellement traduites',
    };
  }
  return {
    fidelity: 'interface',
    label: 'Interface reconstruite — aucun comportement reproduit',
  };
}

/* ------------------------------------------------------------------ */
/* Generated files                                                     */
/* ------------------------------------------------------------------ */

function buildChrome(screens: BuildScreen[], galleryOnly: boolean): string {
  const select =
    screens.length > 1
      ? `<label class="a2w-screen-picker"><span>Écrans</span><select id="a2w-screen-select" aria-label="Choisir un écran">${screens
          .map((screen) => `<option value="${screen.id}">${escapeHtml(screen.title)}</option>`)
          .join('')}</select></label>`
      : '';
  return `<div class="a2w-chrome">
  <button type="button" class="a2w-back" data-a2w-action="back" aria-label="Retour" hidden>‹</button>
  ${select}
  <div class="a2w-credit">Reconstruit avec APK2WEB${galleryOnly ? ' — ressources seulement' : ''}</div>
  <div class="a2w-toast" id="a2w-toast" role="status" aria-live="polite"></div>
</div>`;
}

function buildIndexHtml(
  title: string,
  body: string,
  chrome: string,
  galleryOnly: boolean,
): string {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="generator" content="APK2WEB 1.0.0" />
  <meta name="description" content="${escapeAttr(title)} — reconstruction web générée par APK2WEB. Aucune logique Android n'est exécutée." />
  <title>${escapeHtml(title)}${galleryOnly ? ' — ressources' : ''}</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
<div class="a2w-app" id="a2w-app">
${body}
</div>
${chrome}
<script src="src/modules/data.js" defer></script>
<script src="src/modules/router.js" defer></script>
<script src="src/modules/interactions.js" defer></script>
<script src="script.js" defer></script>
</body>
</html>
`;
}

function buildDataModule(
  analysis: Analysis,
  projectName: string,
  fidelity: { fidelity: Fidelity; label: string },
  screens: BuildScreen[],
): string {
  const converted = analysis.interactions.filter((interaction) => interaction.converted).length;
  const payload = {
    project: projectName,
    appLabel: analysis.appLabel,
    packageName: analysis.packageName,
    generatedAt: new Date().toISOString(),
    fidelity: fidelity.fidelity,
    fidelityLabel: fidelity.label,
    screens,
    interactions: { total: analysis.interactions.length, converted },
    notes: analysis.capabilities
      .filter((capability) => capability.state === 'unsupported' || capability.state === 'partial')
      .map((capability) => `${capability.label} : ${capability.detail}`),
  };
  return `/* Généré par APK2WEB — données de la reconstruction. */
window.APK2WEB_DATA = ${JSON.stringify(payload, null, 2).replace(/<\/script/gi, '<\\/script')};
`;
}

function buildBootstrap(hasScreens: boolean): string {
  if (!hasScreens) {
    return `/* Généré par APK2WEB — page de ressources (aucune interface Android reconstruite). */
document.addEventListener('DOMContentLoaded', function () {
  var toast = document.getElementById('a2w-toast');
  if (toast) {
    toast.textContent = "Aucune interface Android n'a pu être reconstruite pour ce projet.";
    toast.classList.add('is-visible');
  }
});
`;
  }
  return `/* Généré par APK2WEB — amorçage du site reconstruit. */
document.addEventListener('DOMContentLoaded', function () {
  if (window.A2W_ROUTER) window.A2W_ROUTER.init();
  if (window.A2W_UI) window.A2W_UI.init();
});
`;
}

function buildStyleCss(analysis: Analysis): string {
  const background = resolveColorRef(analysis.colors.background, analysis.colors) ?? '#ffffff';
  const foreground = resolveColorRef(analysis.colors.textColor, analysis.colors) ?? '#14161c';
  return `/* Généré par APK2WEB — feuille de style de la reconstruction. */
:root {
  color-scheme: light;
  --a2w-bg: ${background};
  --a2w-fg: ${foreground};
  --a2w-accent: #6a5cff;
  --a2w-border: rgba(20, 22, 28, 0.12);
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; min-height: 100%; }
body {
  font-family: Roboto, "Helvetica Neue", system-ui, -apple-system, "Segoe UI", sans-serif;
  background: var(--a2w-bg);
  color: var(--a2w-fg);
  -webkit-font-smoothing: antialiased;
}
img { max-width: 100%; }
.a2w-app { min-height: 100vh; position: relative; overflow-x: hidden; }
.a2w-screen { min-height: 100vh; position: relative; }
.a2w-screen[hidden] { display: none !important; }
.a2w-screen-root { width: 100%; min-height: 100vh; display: flex; flex-direction: column; }
.a2w-view { flex-shrink: 0; }
.a2w-text { line-height: 1.4; word-wrap: break-word; }
.a2w-button {
  appearance: none;
  border: 0;
  border-radius: 8px;
  background: var(--a2w-accent);
  color: #fff;
  font: inherit;
  padding: 10px 18px;
  cursor: pointer;
  transition: filter .15s ease, transform .15s ease;
}
.a2w-button:hover { filter: brightness(1.06); }
.a2w-button:active { transform: translateY(1px); filter: brightness(.94); }
.a2w-input, .a2w-select {
  appearance: none;
  border: 1px solid var(--a2w-border);
  border-radius: 8px;
  padding: 10px 12px;
  font: inherit;
  background: #fff;
  color: inherit;
  min-height: 42px;
}
.a2w-input:focus, .a2w-select:focus { outline: 2px solid color-mix(in srgb, var(--a2w-accent) 55%, transparent); outline-offset: 1px; }
.a2w-choice { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; padding: 4px 0; }
.a2w-choice input { width: 18px; height: 18px; accent-color: var(--a2w-accent); }
.a2w-range { width: 100%; accent-color: var(--a2w-accent); }
.a2w-progress { width: 100%; height: 6px; border-radius: 999px; background: rgba(20,22,28,.1); overflow: hidden; position: relative; }
.a2w-progress > span { display: block; height: 100%; background: var(--a2w-accent); border-radius: inherit; }
.a2w-progress--indeterminate > span { width: 35% !important; animation: a2w-indeterminate 1.3s ease-in-out infinite; }
@keyframes a2w-indeterminate { 0% { margin-left: -35%; } 100% { margin-left: 100%; } }
.a2w-image { display: block; object-fit: contain; }
.a2w-image--missing {
  display: flex; align-items: center; justify-content: center; min-height: 72px; padding: 10px;
  color: rgba(20,22,28,.45); font-size: 12px; border: 1px dashed var(--a2w-border);
  background: repeating-linear-gradient(45deg, rgba(20,22,28,.035) 0 8px, transparent 8px 16px);
}
.a2w-list { display: flex; flex-direction: column; width: 100%; border: 1px solid var(--a2w-border); border-radius: 10px; overflow: hidden; background: #fff; }
.a2w-list--grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); border: 0; gap: 8px; background: transparent; }
.a2w-list-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 14px; border-bottom: 1px solid var(--a2w-border); background: #fff; }
.a2w-list-item:last-child { border-bottom: 0; }
.a2w-list--grid .a2w-list-item { border: 1px solid var(--a2w-border); border-radius: 8px; }
.a2w-chevron { opacity: .35; }
.a2w-webview, .a2w-surface, .a2w-video, .a2w-fragment {
  display: flex; flex-direction: column; gap: 4px; align-items: flex-start; justify-content: center;
  border: 1px dashed var(--a2w-border); border-radius: 10px; padding: 14px; min-height: 84px;
  font-size: 12px; color: rgba(20,22,28,.6); background: rgba(20,22,28,.02); width: 100%; border: 0;
}
.a2w-webview iframe { width: 100%; height: 320px; border: 0; }
.a2w-surface, .a2w-video { min-height: 140px; }
.a2w-fab {
  width: 52px; height: 52px; border-radius: 50%; border: 0; background: var(--a2w-accent); color: #fff;
  font-size: 22px; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,.22);
  display: inline-flex; align-items: center; justify-content: center;
}
.a2w-tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--a2w-border); }
.a2w-tab { padding: 10px 14px; font-size: 13px; font-weight: 600; opacity: .6; }
.a2w-space { flex: 1 1 auto; }
.a2w-note { font-size: 12px; opacity: .6; padding: 8px 0; }
.a2w-note--inline { padding: 10px 14px; }
.a2w-unresolved { opacity: .7; }
.a2w-interactive:hover { filter: brightness(.97); }
.a2w-chrome { position: fixed; inset: 0; pointer-events: none; z-index: 10; }
.a2w-back {
  pointer-events: auto; position: fixed; top: 10px; left: 10px; width: 38px; height: 38px; border-radius: 50%;
  border: 1px solid rgba(255,255,255,.35); background: rgba(20,22,28,.55); color: #fff; font-size: 22px;
  line-height: 1; cursor: pointer; backdrop-filter: blur(6px);
}
.a2w-back[hidden] { display: none; }
.a2w-screen-picker {
  pointer-events: auto; position: fixed; right: 10px; top: 10px; display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; border-radius: 999px; background: rgba(20,22,28,.55); color: #fff; font-size: 11px;
  backdrop-filter: blur(6px);
}
.a2w-screen-picker select { background: transparent; border: 0; color: inherit; font: inherit; max-width: 150px; }
.a2w-screen-picker option { color: #111; }
.a2w-credit { position: fixed; right: 10px; bottom: 8px; font-size: 10px; letter-spacing: .02em; opacity: .38; }
.a2w-toast {
  pointer-events: auto; position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 16px);
  background: rgba(20,22,28,.92); color: #fff; padding: 10px 16px; border-radius: 10px; font-size: 13px;
  max-width: min(90vw, 420px); opacity: 0; transition: opacity .2s ease, transform .2s ease;
}
.a2w-toast.is-visible { opacity: 1; transform: translate(-50%, 0); }
/* Galerie de ressources */
.a2w-gallery { padding: 32px clamp(16px, 4vw, 48px) 64px; gap: 10px; background: #fff; }
.a2w-gallery-head h1 { margin: 0 0 8px; font-size: clamp(22px, 3vw, 30px); }
.a2w-gallery-head p { margin: 0; max-width: 720px; color: rgba(20,22,28,.65); line-height: 1.6; }
.a2w-gallery h2 { margin: 28px 0 10px; font-size: 15px; text-transform: uppercase; letter-spacing: .08em; }
.a2w-gallery h2 span { opacity: .45; font-weight: 400; }
.a2w-gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; }
.a2w-gallery-item { margin: 0; border: 1px solid var(--a2w-border); border-radius: 10px; padding: 8px; background: #fafafa; }
.a2w-gallery-item img { width: 100%; height: 96px; object-fit: contain; }
.a2w-gallery-item figcaption { font-size: 11px; opacity: .6; margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.a2w-gallery-sound { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--a2w-border); font-size: 13px; }
.a2w-gallery-sound audio { height: 32px; }
.a2w-gallery-fonts { padding-left: 18px; font-size: 13px; }
.a2w-gallery-fonts span { opacity: .45; margin-left: 8px; }
.a2w-gallery-foot { margin-top: 36px; font-size: 11px; opacity: .45; }
@media (max-width: 480px) {
  .a2w-screen-picker { top: 8px; right: 8px; }
  .a2w-gallery { padding: 24px 16px 56px; }
}
`;
}

const ROUTER_MODULE = `/* Généré par APK2WEB — routeur d'écrans (hash, sans dépendance). */
window.A2W_ROUTER = (function () {
  var stack = [];
  var screens = (window.APK2WEB_DATA && window.APK2WEB_DATA.screens) || [];

  function current() {
    return stack.length > 0 ? stack[stack.length - 1] : null;
  }

  function apply(id) {
    var target = document.getElementById(id);
    if (!target) return false;
    var nodes = document.querySelectorAll('.a2w-screen');
    for (var i = 0; i < nodes.length; i += 1) {
      nodes[i].hidden = nodes[i].id !== id;
    }
    var select = document.getElementById('a2w-screen-select');
    if (select) select.value = id;
    var back = document.querySelector('.a2w-back');
    if (back) back.hidden = stack.length <= 1;
    try { window.scrollTo(0, 0); } catch (error) { /* ignore */ }
    return true;
  }

  function show(id, options) {
    if (!document.getElementById(id)) return false;
    if (stack[stack.length - 1] !== id) stack.push(id);
    apply(id);
    if (!options || options.hash !== false) {
      try { history.replaceState(null, '', '#' + id); }
      catch (error) { window.location.hash = id; }
    }
    document.title = (window.APK2WEB_DATA ? window.APK2WEB_DATA.appLabel : 'APK2WEB') + ' — ' + id;
    return true;
  }

  function back() {
    if (stack.length > 1) {
      stack.pop();
      var previous = stack[stack.length - 1];
      apply(previous);
      try { history.replaceState(null, '', '#' + previous); } catch (error) { /* ignore */ }
    } else if (stack.length === 1 && screens.length > 1) {
      show(screens[0].id);
    }
  }

  function init() {
    var hash = window.location.hash.replace(/^#/, '');
    var ids = [];
    for (var i = 0; i < screens.length; i += 1) ids.push(screens[i].id);
    var first = ids.length > 0 ? ids[0] : null;
    var start = hash && ids.indexOf(hash) >= 0 ? hash : first;
    if (start) {
      stack = [start];
      apply(start);
    }
    var select = document.getElementById('a2w-screen-select');
    if (select) {
      select.addEventListener('change', function () {
        if (select.value) show(select.value);
      });
    }
    window.addEventListener('hashchange', function () {
      var next = window.location.hash.replace(/^#/, '');
      if (next && document.getElementById(next) && next !== current()) show(next, { hash: false });
    });
  }

  return { init: init, show: show, back: back, current: current };
})();
`;

const INTERACTIONS_MODULE = `/* Généré par APK2WEB — interactions reconstruites (simulation, sans code Android). */
window.A2W_UI = (function () {
  var toastTimer = null;

  function toast(message) {
    var node = document.getElementById('a2w-toast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('is-visible');
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { node.classList.remove('is-visible'); }, 2600);
  }

  function playSound(url) {
    try {
      var audio = new Audio(url);
      var promise = audio.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(function () { toast('Lecture audio bloquée par le navigateur'); });
      }
    } catch (error) {
      toast('Lecture audio impossible');
    }
  }

  function toggleTarget(element) {
    var selector = element.getAttribute('data-a2w-toggle-target');
    if (selector) {
      var target = document.querySelector(selector);
      if (target) {
        target.hidden = !target.hidden;
        return true;
      }
    }
    return false;
  }

  function handle(event) {
    var element = event.target && event.target.closest ? event.target.closest('[data-a2w-action]') : null;
    if (!element) return;
    var action = element.getAttribute('data-a2w-action');
    var label = element.getAttribute('data-a2w-label') || '';
    var handler = element.getAttribute('data-a2w-handler') || '';
    var target = element.getAttribute('data-a2w-target');

    if (action === 'navigate' && target && window.A2W_ROUTER) {
      window.A2W_ROUTER.show(target);
      return;
    }
    if (action === 'back' && window.A2W_ROUTER) {
      window.A2W_ROUTER.back();
      return;
    }
    if (action === 'toggle') {
      if (!toggleTarget(element)) element.classList.toggle('a2w-toggled');
      toast('Bascule simulée' + (label ? ' : ' + label : ''));
      return;
    }
    if (action === 'sound') {
      var sound = element.getAttribute('data-a2w-sound');
      if (sound) playSound(sound);
      else toast('Aucun son associé à cette action');
      return;
    }
    if (action === 'notify') {
      toast(label || 'Message simulé');
      return;
    }
    toast('Action non convertie : ' + (label || handler || 'inconnue'));
  }

  function init() {
    document.addEventListener('click', handle);
  }

  return { init: init, toast: toast };
})();
`;

const HTACCESS = `# APK2WEB — configuration pour hébergement Apache (o2switch, cPanel…)
DirectoryIndex index.html
Options -Indexes
AddDefaultCharset UTF-8

<IfModule mod_mime.c>
  AddType image/svg+xml .svg
  AddType font/woff2 .woff2
  AddType font/woff .woff
  AddType audio/mpeg .mp3
  AddType audio/ogg .ogg
  AddType text/javascript .js
</IfModule>

<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css text/plain text/javascript application/javascript application/json image/svg+xml
</IfModule>

<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/css "access plus 7 days"
  ExpiresByType application/javascript "access plus 7 days"
  ExpiresByType text/javascript "access plus 7 days"
  ExpiresByType image/png "access plus 30 days"
  ExpiresByType image/jpeg "access plus 30 days"
  ExpiresByType image/webp "access plus 30 days"
  ExpiresByType font/woff2 "access plus 30 days"
</IfModule>

<IfModule mod_headers.c>
  Header set X-Content-Type-Options "nosniff"
  Header set Referrer-Policy "strict-origin-when-cross-origin"
</IfModule>

<FilesMatch "^\\.(ht|git|env)">
  <IfModule mod_authz_core.c>
    Require all denied
  </IfModule>
  <IfModule !mod_authz_core.c>
    Order allow,deny
    Deny from all
  </IfModule>
</FilesMatch>
`;

function buildReadme(
  analysis: Analysis,
  screens: BuildScreen[],
  fidelity: { fidelity: Fidelity; label: string },
  diagnostics: Diagnostic[],
  assets: BuildAsset[],
  used: Set<string>,
  input: BuildInput,
): string {
  const missing = analysis.capabilities.filter(
    (capability) => capability.state === 'unsupported' || capability.state === 'partial',
  );
  const converted = analysis.interactions.filter((interaction) => interaction.converted).length;
  const imageCount = assets.filter((asset) => asset.kind === 'image').length;
  const soundCount = assets.filter((asset) => asset.kind === 'sound').length;
  const fontCount = assets.filter((asset) => asset.kind === 'font').length;
  return `# ${analysis.appLabel} — reconstruction web APK2WEB

> **Conversion partielle et honnête.** Ce site est une **reconstruction** HTML/CSS/JS des ressources et
> de l'interface d'une application Android. **Aucun code Android (Dalvik/Smali) n'est exécuté.**
> Le rendu ne peut pas être identique à l'application d'origine et les fonctionnalités métier
> ne sont pas reproduites.

- Application source : \`${analysis.packageName}\`${analysis.versionName ? ` (version ${analysis.versionName})` : ''}
- Projet APK2WEB : \`${input.projectName}\`
- Généré le : ${new Date().toLocaleString('fr-FR')}
- Niveau de fidélité : **${fidelity.label}**
- Écrans reconstruits : ${screens.length}
- Interactions traduites : ${converted} / ${analysis.interactions.length}
- Ressources copiées : ${imageCount} image(s), ${soundCount} son(s), ${fontCount} police(s)
- Ressources réellement référencées par l'interface : ${used.size}

## Écrans

${screens.length > 0 ? screens.map((screen, index) => `${index + 1}. **${screen.title}** — layout \`${screen.layout}\`${screen.activity ? ` (activité \`${screen.activity}\`)` : ''}`).join('\n') : '_Aucun écran reconstruit : seules les ressources sont présentées._'}

## Ce qui a été reconstruit

${analysis.capabilities
  .filter((capability) => capability.state === 'ok' || capability.state === 'simulated')
  .map((capability) => `- **${capability.label}** — ${capability.detail}`)
  .join('\n') || '- Aucune capacité complète.'}

## Éléments manquants ou approximatifs

${missing.map((capability) => `- **${capability.label}** (${capability.state}) — ${capability.detail}`).join('\n') || '- Aucun élément manquant signalé.'}

${analysis.engines.length > 0 ? `## Moteurs / frameworks détectés\n\n${analysis.engines.map((engine) => `- **${engine.label}** — \`${engine.evidence}\`${engine.blocksGameplay ? ' (non exécutable dans un navigateur)' : ''}`).join('\n')}\n` : ''}

## Arborescence

\`\`\`
APK2WEB/
├── index.html          # point d'entrée
├── style.css           # styles de la reconstruction
├── script.js           # amorçage
├── src/modules/
│   ├── data.js         # écrans et métadonnées
│   ├── router.js       # navigation entre écrans
│   └── interactions.js # actions simulées (clic, son, message)
├── assets/
│   ├── images/
│   ├── sounds/
│   └── fonts/
├── README.md
└── .htaccess
\`\`\`

## Installation

1. Décompressez l'archive ZIP.
2. Copiez **tout le contenu** du dossier dans \`public_html\` (ou un sous-dossier) de votre hébergement.
3. Ouvrez \`https://votre-domaine.tld/\` : \`index.html\` est le point d'entrée.
4. En local, un simple serveur statique suffit : \`python3 -m http.server 8080\`.

Le site fonctionne aussi en ouvrant \`index.html\` directement : aucun module ES, aucune compilation,
aucune dépendance locale n'est nécessaire.

## Diagnostic de génération

${diagnostics
  .filter((diagnostic) => diagnostic.level !== 'info')
  .slice(0, 30)
  .map((diagnostic) => `- [${diagnostic.level}] ${diagnostic.message}${diagnostic.detail ? ` — ${diagnostic.detail}` : ''}`)
  .join('\n') || '- Aucun avertissement bloquant.'}

## Mentions légales

Cette reconstruction doit être utilisée uniquement pour des applications dont vous détenez les droits
(application personnelle, open source, autorisation écrite de l'éditeur). Les marques, ressources et
contenus de l'application d'origine restent la propriété de leurs ayants droit.
`;
}

function applyEdits(files: GeneratedTextFile[], edits: Record<string, string>): GeneratedTextFile[] {
  return files.map((file) => {
    const edited = edits[file.path];
    return edited === undefined ? file : { ...file, text: edited };
  });
}

/* ------------------------------------------------------------------ */
/* Preview composition                                                 */
/* ------------------------------------------------------------------ */

const PREVIEW_BRIDGE = `(function () {
  var errors = [];
  function post(type, payload) {
    var message = payload || {};
    message.source = 'apk2web';
    message.type = type;
    try { window.parent.postMessage(message, '*'); } catch (error) { /* ignore */ }
  }
  function forward(level, args) {
    var text = Array.prototype.map.call(args, function (value) {
      if (value instanceof Error) return value.message;
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch (error) { return String(value); }
    }).join(' ');
    if (level === 'error') errors.push(text);
    post('console', { level: level, message: text });
  }
  ['log', 'info', 'warn', 'error'].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      forward(level, arguments);
      if (original) original.apply(console, arguments);
    };
  });
  window.addEventListener('error', function (event) {
    errors.push(String(event.message || 'Erreur inconnue'));
    post('console', { level: 'error', message: String(event.message || 'Erreur inconnue') });
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason && event.reason.message ? event.reason.message : String(event.reason);
    errors.push(reason);
    post('console', { level: 'error', message: 'Promesse rejetée : ' + reason });
  });
  function report() {
    var screens = Array.prototype.map.call(document.querySelectorAll('.a2w-screen'), function (node) {
      return { id: node.id, nodes: node.querySelectorAll('*').length, hidden: node.hidden };
    });
    post('ready', {
      report: {
        screens: screens,
        actions: document.querySelectorAll('[data-a2w-action]').length,
        router: Boolean(window.A2W_ROUTER),
        ui: Boolean(window.A2W_UI),
        fidelity: window.APK2WEB_DATA ? window.APK2WEB_DATA.fidelity : null,
        errors: errors.slice(0, 20),
        title: document.title
      }
    });
  }
  window.addEventListener('load', function () { window.setTimeout(report, 80); });
})();
`;

async function composePreview(options: {
  indexHtml: string;
  css: string;
  modules: Record<string, string>;
  script: string;
  used: Set<string>;
  assets: BuildAsset[];
  readDataUrl?: (path: string, mime: string) => Promise<string | null>;
  inlineLimit: number;
  hasScreens: boolean;
}): Promise<string> {
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(options.indexHtml);
  let body = bodyMatch ? bodyMatch[1] : options.indexHtml;
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '');

  const moduleText = Object.values(options.modules).join('\n');
  let html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(/<title>([\s\S]*?)<\/title>/i.exec(options.indexHtml)?.[1] ?? 'APK2WEB')}</title>
<style id="a2w-style">${options.css}</style>
</head>
<body>
${body}
<hr class="a2w-preview-separator" />
<script id="a2w-modules">${moduleText.replace(/<\/script/gi, '<\\/script')}</script>
<script id="a2w-script">${options.script.replace(/<\/script/gi, '<\\/script')}</script>
<script id="a2w-bridge">${PREVIEW_BRIDGE}</script>
</body>
</html>`;

  // Inline referenced assets so the isolated iframe (no same-origin access to the app)
  // can display them without fetching from the parent origin.
  const inlineMap = new Map<string, string>();
  let budget = options.inlineLimit;
  if (options.readDataUrl) {
    for (const asset of options.assets) {
      if (asset.kind === 'web') continue;
      if (!options.used.has(asset.target)) continue;
      const limit = asset.kind === 'image' ? 4 * 1024 * 1024 : 400 * 1024;
      if (budget <= 0) break;
      try {
        const dataUrl = await options.readDataUrl(asset.source, 'application/octet-stream');
        if (!dataUrl) continue;
        if (dataUrl.length > limit || dataUrl.length > budget) continue;
        budget -= dataUrl.length;
        inlineMap.set(asset.target, dataUrl);
      } catch {
        /* skip asset */
      }
    }
  }
  if (inlineMap.size > 0) {
    html = html.replace(/assets\/(images|sounds|fonts)\/[^"'()\s<]+/g, (match) => inlineMap.get(match) ?? match);
  }
  return html;
}
