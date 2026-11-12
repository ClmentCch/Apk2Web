import { analyzeProject } from '../lib/analyze';
import { buildSite, type BuildResult } from '../lib/convert';
import {
  addFiles,
  clearEdit,
  getFileBlob,
  getFileText,
  getProject,
  listEdits,
  listFiles,
  saveBuildSummary,
  saveEdit,
  saveProject,
  type FileEntry,
} from '../lib/db';
import { formatBytes } from '../lib/files';
import { downloadBlob, exportSiteZip } from '../lib/exporter';
import { ingestFromDataTransfer, ingestFromFileList, type IngestResult } from '../lib/ingest';
import type { Analysis, FileKind, LogEntry, LogLevel, ProjectMeta } from '../lib/types';
import { navigate } from './app';
import { busy } from './busy';
import {
  buttonIcon,
  clear,
  confirmDialog,
  el,
  emptyState,
  formatDate,
  icon,
  toast,
} from './dom';

type Tab = 'explorer' | 'preview' | 'editor' | 'console' | 'report';

interface PreviewReport {
  screens: { id: string; nodes: number; hidden?: boolean }[];
  actions: number;
  router: boolean;
  ui: boolean;
  fidelity: string | null;
  errors: string[];
  title?: string;
}

interface TreeFolder {
  name: string;
  path: string;
  folders: Map<string, TreeFolder>;
  files: FileEntry[];
}

interface State {
  projectId: string;
  meta: ProjectMeta;
  files: FileEntry[];
  edits: Record<string, string>;
  analysis?: Analysis;
  build?: BuildResult;
  logs: LogEntry[];
  tab: Tab;
  selectedFile?: string;
  editorPath?: string;
  editorText: string;
  editorDirty: boolean;
  device: string;
  testedAt?: number;
  testReport?: PreviewReport;
  running: boolean;
  previewHtml?: string;
}

const DEVICES: { id: string; label: string; width?: number; height?: number; icon: string }[] = [
  { id: 'auto', label: 'Responsive', icon: 'monitor' },
  { id: '360x640', label: '360 × 640', width: 360, height: 640, icon: 'phone' },
  { id: '390x844', label: '390 × 844', width: 390, height: 844, icon: 'phone' },
  { id: '412x915', label: '412 × 915', width: 412, height: 915, icon: 'phone' },
  { id: '768x1024', label: '768 × 1024', width: 768, height: 1024, icon: 'tablet' },
  { id: '1280x800', label: '1280 × 800', width: 1280, height: 800, icon: 'monitor' },
];

let objectUrl: string | null = null;

export async function renderWorkspace(view: HTMLElement, projectId: string): Promise<void> {
  const meta = await getProject(projectId);
  if (!meta) {
    view.appendChild(
      el('div', { class: 'panel error-panel' }, [
        el('h2', { text: 'Projet introuvable' }),
        el('p', { text: 'Ce projet n’existe pas dans le stockage local de ce navigateur.' }),
        el('button', {
          class: 'btn btn--ghost',
          text: 'Revenir au tableau de bord',
          on: { click: () => navigate('/') },
        }),
      ]),
    );
    return;
  }

  const state: State = {
    projectId,
    meta,
    files: await listFiles(projectId),
    edits: await listEdits(projectId),
    logs: [],
    tab: 'explorer',
    editorText: '',
    editorDirty: false,
    device: 'auto',
    running: false,
    testedAt: meta.testedAt,
  };

  const fileInput = el('input', {
    attrs: { type: 'file', multiple: true, hidden: true, accept: '.zip,.apk,.aab,.xapk' },
  });
  const folderInput = el('input', {
    attrs: { type: 'file', webkitdirectory: '', directory: '', multiple: true, hidden: true },
  });

  const head = el('header', { class: 'ws-head' });
  const tabs = el('nav', { class: 'tabs', attrs: { role: 'tablist', 'aria-label': 'Sections du projet' } });
  const body = el('div', { class: 'ws-body' });
  const workspace = el('div', { class: 'workspace' }, [head, tabs, body, fileInput, folderInput]);
  view.appendChild(workspace);

  let pendingTest: ((report: PreviewReport | null) => void) | null = null;
  let previewFrame: HTMLIFrameElement | null = null;
  let consoleFilter: LogLevel | 'all' = 'all';
  const expanded = new Set<string>();
  let searchQuery = '';

  const listenerController = new AbortController();
  window.addEventListener(
    'message',
    (event: MessageEvent) => {
      const data = event.data as {
        source?: string;
        type?: string;
        level?: LogLevel;
        message?: string;
        report?: PreviewReport;
      } | null;
      if (!data || data.source !== 'apk2web') return;
      if (data.type === 'console' && data.message !== undefined) {
        log(data.level ?? 'info', 'aperçu', data.message);
      }
      if (data.type === 'ready' && data.report) {
        state.testReport = data.report;
        if (pendingTest) {
          const resolve = pendingTest;
          pendingTest = null;
          resolve(data.report);
        }
        if (state.tab === 'report') renderBody();
      }
    },
    { signal: listenerController.signal },
  );
  window.addEventListener('hashchange', () => listenerController.abort(), { once: true });

  fileInput.addEventListener('change', () => {
    const files = fileInput.files;
    if (files && files.length > 0) void importFiles(() => ingestFromFileList(files));
    fileInput.value = '';
  });
  folderInput.addEventListener('change', () => {
    const files = folderInput.files;
    if (files && files.length > 0) void importFiles(() => ingestFromFileList(files));
    folderInput.value = '';
  });

  workspace.addEventListener('dragover', (event) => {
    event.preventDefault();
    workspace.classList.add('is-dragover');
  });
  workspace.addEventListener('dragleave', (event) => {
    if (event.target === workspace) workspace.classList.remove('is-dragover');
  });
  workspace.addEventListener('drop', (event) => {
    event.preventDefault();
    workspace.classList.remove('is-dragover');
    const dataTransfer = event.dataTransfer;
    if (dataTransfer) void importFiles(() => ingestFromDataTransfer(dataTransfer));
  });

  renderHead();
  renderTabs();
  renderBody();

  if (state.files.length > 0) {
    void runPipeline('auto');
  } else {
    log('info', 'projet', 'Projet vide : importez un APK, un ZIP décompilé ou un dossier.');
  }

  /* ---------------------------------------------------------------- */
  /* Logging                                                           */
  /* ---------------------------------------------------------------- */
  function log(level: LogLevel, source: string, message: string): void {
    state.logs.push({ id: crypto.randomUUID(), at: Date.now(), level, source, message });
    if (state.logs.length > 400) state.logs.splice(0, state.logs.length - 400);
    if (state.tab === 'console') renderConsoleEntries();
  }

  /* ---------------------------------------------------------------- */
  /* Header / tabs                                                     */
  /* ---------------------------------------------------------------- */
  function statusMeta(): { label: string; tone: string } {
    switch (state.meta.status) {
      case 'tested':
        return { label: 'Testé dans l’aperçu', tone: 'ok' };
      case 'generated':
        return { label: 'Site généré', tone: 'info' };
      case 'imported':
        return { label: 'Importé', tone: 'neutral' };
      default:
        return { label: 'Vide', tone: 'neutral' };
    }
  }

  function renderHead(): void {
    clear(head);
    const status = statusMeta();
    const chips = el('div', { class: 'chips' }, [
      el('span', { class: `chip chip--${status.tone}` }, [
        el('span', { class: 'chip__dot' }),
        status.label,
      ]),
      state.build
        ? el('span', {
            class: `chip chip--fidelity-${state.build.fidelity}`,
            text: state.build.fidelityLabel,
          })
        : el('span', { class: 'chip chip--muted', text: 'Non analysé' }),
      el('span', { class: 'chip chip--muted', text: `${state.files.length.toLocaleString('fr-FR')} fichiers` }),
      el('span', { class: 'chip chip--muted', text: formatBytes(state.meta.totalSize) }),
    ]);
    if (state.analysis) {
      chips.appendChild(
        el('span', {
          class: 'chip chip--muted',
          text: `${state.analysis.packageName}${state.analysis.versionName ? ` · v${state.analysis.versionName}` : ''}`,
        }),
      );
    }
    if (state.analysis?.engines.length) {
      chips.appendChild(
        el('span', {
          class: 'chip chip--warn',
          text: `Moteur : ${state.analysis.engines.map((engine) => engine.label).join(', ')}`,
        }),
      );
    }

    head.append(
      el('div', { class: 'ws-head__left' }, [
        el('a', { class: 'crumb', attrs: { href: '#/' }, html: `${icon('arrowLeft')}<span>Projets</span>` }),
        el('h1', { text: state.meta.name }),
        chips,
      ]),
      el('div', { class: 'ws-head__actions' }, [
        el('button', {
          class: 'btn btn--ghost',
          attrs: { type: 'button' },
          html: `${icon('upload')}<span>Importer</span>`,
          title: 'Importer des fichiers (APK, ZIP) ou un dossier',
          on: { click: () => fileInput.click() },
        }),
        el('button', {
          class: 'btn btn--ghost',
          attrs: { type: 'button' },
          text: 'Dossier',
          title: 'Importer un dossier décompilé',
          on: { click: () => folderInput.click() },
        }),
        el('button', {
          class: 'btn btn--soft',
          attrs: { type: 'button' },
          html: `${icon('refresh')}<span>Analyser</span>`,
          on: { click: () => void runPipeline('manual') },
        }),
        el('button', {
          class: 'btn btn--soft',
          attrs: { type: 'button' },
          html: `${icon('play')}<span>Générer le site</span>`,
          on: { click: () => void runPipeline('manual') },
        }),
        el('button', {
          class: 'btn btn--soft',
          attrs: { type: 'button' },
          html: `${icon('check')}<span>Tester</span>`,
          on: { click: () => void runTest() },
        }),
        el('button', {
          class: 'btn btn--primary',
          attrs: { type: 'button' },
          html: `${icon('download')}<span>Exporter en ZIP</span>`,
          on: { click: () => void runExport() },
        }),
      ]),
    );
  }

  function renderTabs(): void {
    clear(tabs);
    const items: { id: Tab; label: string; icon: string }[] = [
      { id: 'explorer', label: 'Explorateur', icon: 'folder' },
      { id: 'preview', label: 'Web Preview', icon: 'play' },
      { id: 'editor', label: 'Éditeur', icon: 'code' },
      { id: 'console', label: 'Console', icon: 'terminal' },
      { id: 'report', label: 'Rapport', icon: 'chart' },
    ];
    for (const item of items) {
      const button = el('button', {
        class: `tab${state.tab === item.id ? ' is-active' : ''}`,
        attrs: {
          type: 'button',
          role: 'tab',
          'aria-selected': state.tab === item.id ? 'true' : 'false',
        },
        html: `${icon(item.icon)}<span>${item.label}</span>${
          item.id === 'console' && state.logs.some((entry) => entry.level === 'error')
            ? '<span class="tab__dot" aria-label="erreurs"></span>'
            : ''
        }`,
        on: {
          click: () => {
            state.tab = item.id;
            renderTabs();
            renderBody();
          },
        },
      });
      tabs.appendChild(button);
    }
  }

  function renderBody(): void {
    body.textContent = '';
    switch (state.tab) {
      case 'explorer':
        body.appendChild(renderExplorer());
        break;
      case 'preview':
        body.appendChild(renderPreview());
        break;
      case 'editor':
        body.appendChild(renderEditor());
        break;
      case 'console':
        body.appendChild(renderConsole());
        break;
      case 'report':
        body.appendChild(renderReport());
        break;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Pipeline                                                          */
  /* ---------------------------------------------------------------- */
  async function runPipeline(reason: 'auto' | 'manual' | 'import' | 'edit'): Promise<void> {
    if (state.running) return;
    if (state.files.length === 0) {
      toast('Importez d’abord des fichiers dans le projet.', 'error');
      state.tab = 'explorer';
      renderTabs();
      renderBody();
      return;
    }
    state.running = true;
    const release = busy(reason === 'auto' ? 'Analyse du projet…' : 'Analyse et génération du site…');
    log('info', 'pipeline', reason === 'auto' ? 'Analyse automatique du projet.' : 'Analyse et génération lancées.');
    try {
      state.edits = await listEdits(state.projectId);
      const projectId = state.projectId;
      const analysis = await analyzeProject({
        projectName: state.meta.name,
        files: state.files,
        readText: async (path) => state.edits[path] ?? (await getFileText(projectId, path)),
      });
      state.analysis = analysis;

      const build = await buildSite({
        projectName: state.meta.name,
        analysis,
        files: state.files,
        edits: state.edits,
        readDataUrl: async (path) => {
          const blob = await getFileBlob(projectId, path);
          return blob ? await blobToDataUrl(blob) : null;
        },
      });
      state.build = build;
      state.previewHtml = build.previewHtml;

      for (const diagnostic of build.diagnostics) {
        if (analysis.diagnostics.includes(diagnostic)) continue;
        log(diagnostic.level === 'error' ? 'error' : diagnostic.level === 'warn' ? 'warn' : 'info', 'génération', diagnostic.message);
      }

      if (reason === 'edit') state.testedAt = undefined;
      const issueCount = build.diagnostics.filter((diagnostic) => diagnostic.level !== 'info').length;
      const nextMeta: ProjectMeta = {
        ...state.meta,
        status: state.testedAt ? 'tested' : 'generated',
        packageName: analysis.packageName,
        appLabel: analysis.appLabel,
        versionName: analysis.versionName,
        fidelity: build.fidelity,
        fidelityLabel: build.fidelityLabel,
        screenCount: build.screens.length,
        issueCount,
        engineLabel: analysis.engines.map((engine) => engine.label).join(', ') || undefined,
        testedAt: state.testedAt,
        updatedAt: Date.now(),
      };
      state.meta = nextMeta;
      await saveProject(nextMeta);
      await saveBuildSummary({
        projectId,
        createdAt: build.createdAt,
        fidelity: build.fidelity,
        fidelityLabel: build.fidelityLabel,
        screens: build.screens,
        diagnostics: build.diagnostics.map(({ level, code, message }) => ({ level, code, message })),
        capabilities: build.capabilities.map(({ key, label, state: capabilityState, detail }) => ({
          key,
          label,
          state: capabilityState,
          detail,
        })),
        interactions: build.interactions.length,
        testedAt: state.testedAt,
      });

      log(
        'success',
        'génération',
        `Site généré : ${build.screens.length} écran(s), ${build.assets.length} ressource(s), fidélité « ${build.fidelityLabel} ».`,
      );
      if (build.assetBudgetExceeded) {
        log('warn', 'export', "Budget de ressources dépassé : certains fichiers ne seront pas inclus dans le ZIP.");
      }
      renderHead();
      renderTabs();
      renderBody();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log('error', 'pipeline', `Échec : ${message}`);
      toast(message, 'error');
    } finally {
      state.running = false;
      release();
    }
  }

  async function importFiles(run: () => Promise<IngestResult>): Promise<void> {
    const release = busy('Import des fichiers…');
    try {
      const result = await run();
      if (result.files.length === 0) {
        for (const warning of result.warnings.slice(0, 3)) toast(warning, 'error');
        toast("Aucun fichier exploitable n'a été importé.", 'error');
        return;
      }
      await addFiles(state.projectId, result.files);
      state.files = await listFiles(state.projectId);
      state.testedAt = undefined;
      state.meta = {
        ...state.meta,
        fileCount: state.files.length,
        totalSize: state.files.reduce((sum, file) => sum + file.size, 0),
        status: 'imported',
        testedAt: undefined,
        updatedAt: Date.now(),
      };
      await saveProject(state.meta);
      log('success', 'import', `${result.files.length} fichier(s) ajouté(s)${result.strippedRoot ? ` (racine « ${result.strippedRoot} » retirée)` : ''}.`);
      for (const warning of result.warnings.slice(0, 3)) log('warn', 'import', warning);
      toast(`${result.files.length} fichier(s) importé(s).`, 'success');
      renderHead();
      renderTabs();
      await runPipeline('import');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log('error', 'import', message);
      toast(message, 'error');
    } finally {
      release();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Explorer                                                          */
  /* ---------------------------------------------------------------- */
  function buildTree(): TreeFolder {
    const root: TreeFolder = { name: '', path: '', folders: new Map(), files: [] };
    for (const file of state.files) {
      const parts = file.path.split('/');
      let current = root;
      for (let i = 0; i < parts.length - 1; i += 1) {
        const name = parts[i];
        const path = parts.slice(0, i + 1).join('/');
        let next = current.folders.get(name);
        if (!next) {
          next = { name, path, folders: new Map(), files: [] };
          current.folders.set(name, next);
        }
        current = next;
      }
      current.files.push(file);
    }
    return root;
  }

  function renderExplorer(): HTMLElement {
    const wrap = el('div', { class: 'explorer' });
    const treeHost = el('div', { class: 'tree' });
    const previewHost = el('section', { class: 'file-preview' });
    const search = el('input', {
      class: 'field field--search',
      attrs: { type: 'search', placeholder: 'Filtrer les fichiers…', value: searchQuery },
    });
    search.addEventListener('input', () => {
      searchQuery = search.value.trim().toLowerCase();
      renderTree();
    });

    const tree = buildTree();
    const topFolders = [...tree.folders.values()];

    function renderTree(): void {
      clear(treeHost);
      if (searchQuery) {
        const matches = state.files.filter((file) => file.path.toLowerCase().includes(searchQuery)).slice(0, 300);
        treeHost.appendChild(
          el('p', { class: 'tree__hint', text: `${matches.length} résultat(s)${matches.length === 300 ? ' (limité)' : ''}` }),
        );
        for (const file of matches) treeHost.appendChild(fileRow(file, 0));
        return;
      }
      if (state.files.length === 0) {
        treeHost.appendChild(
          el('p', { class: 'tree__hint', text: 'Aucun fichier. Utilisez « Importer » ou glissez un dossier.' }),
        );
        return;
      }
      for (const folder of topFolders) treeHost.appendChild(folderRow(folder, 0));
    }

    function folderRow(folder: TreeFolder, depth: number): HTMLElement {
      const isOpen = expanded.has(folder.path);
      const count = countFiles(folder);
      const row = el('button', {
        class: `tree-row tree-row--folder${isOpen ? ' is-open' : ''}`,
        attrs: { type: 'button', style: `padding-left:${8 + depth * 14}px` },
        html: `<span class="tree-row__chevron">${isOpen ? '▾' : '▸'}</span>${icon('folder')}<span class="tree-row__name">${escapeText(
          folder.name,
        )}</span><span class="tree-row__count">${count}</span>`,
        on: {
          click: () => {
            if (isOpen) expanded.delete(folder.path);
            else expanded.add(folder.path);
            renderTree();
          },
        },
      });
      if (!isOpen) return row;
      const children = el('div');
      for (const child of [...folder.folders.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        children.appendChild(folderRow(child, depth + 1));
      }
      for (const file of folder.files.sort((a, b) => a.path.localeCompare(b.path))) {
        children.appendChild(fileRow(file, depth + 1));
      }
      return el('div', { class: 'tree-group' }, [row, children]);
    }

    function fileRow(file: FileEntry, depth: number): HTMLElement {
      const active = state.selectedFile === file.path;
      return el('button', {
        class: `tree-row tree-row--file${active ? ' is-active' : ''}`,
        attrs: { type: 'button', style: `padding-left:${8 + depth * 14}px`, title: file.path },
        html: `<span class="tree-row__icon">${icon(iconForKind(file.kind))}</span><span class="tree-row__name">${escapeText(
          file.path.split('/').pop() ?? file.path,
        )}</span><span class="tree-row__size">${formatBytes(file.size)}</span>`,
        on: {
          click: () => {
            state.selectedFile = file.path;
            renderTree();
            void showFile(file);
          },
        },
      });
    }

    treeHost.appendChild(el('p', { class: 'tree__hint', text: 'Chargement…' }));
    renderTree();

    if (state.selectedFile) {
      const file = state.files.find((entry) => entry.path === state.selectedFile);
      if (file) void showFile(file, previewHost);
    } else {
      previewHost.appendChild(
        emptyState(
          'Explorateur de fichiers',
          'Sélectionnez un fichier pour afficher son contenu. L’arborescence d’origine est conservée, y compris smali/, res/, assets/, lib/ et original/.',
        ),
      );
    }

    wrap.append(
      el('aside', { class: 'explorer__aside' }, [
        el('div', { class: 'pane-toolbar' }, [
          el('div', { class: 'pane-toolbar__title' }, [
            buttonIcon('folder'),
            el('span', { text: 'Arborescence' }),
          ]),
          search,
        ]),
        treeHost,
      ]),
      previewHost,
    );
    return wrap;
  }

  async function showFile(file: FileEntry, host?: HTMLElement): Promise<void> {
    const target = host ?? (body.querySelector('.file-preview') as HTMLElement | null);
    if (!target) return;
    clear(target);
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    target.appendChild(
      el('div', { class: 'file-preview__head' }, [
        el('div', {}, [
          el('p', { class: 'file-preview__path', text: file.path }),
          el('p', { class: 'file-preview__meta', text: `${kindLabel(file.kind)} · ${formatBytes(file.size)}` }),
        ]),
        isEditable(file.kind)
          ? el('button', {
              class: 'btn btn--soft',
              attrs: { type: 'button' },
              html: `${icon('code')}<span>Modifier</span>`,
              on: {
                click: () => {
                  state.tab = 'editor';
                  state.editorPath = file.path;
                  state.editorDirty = false;
                  renderTabs();
                  renderBody();
                },
              },
            })
          : el('span'),
      ]),
    );

    const contentHost = el('div', { class: 'file-preview__content' });
    target.appendChild(contentHost);

    try {
      const blob = await getFileBlob(state.projectId, file.path);
      if (!blob) {
        contentHost.appendChild(el('p', { class: 'note', text: 'Fichier introuvable dans IndexedDB.' }));
        return;
      }
      if (file.kind === 'image') {
        objectUrl = URL.createObjectURL(blob);
        contentHost.appendChild(
          el('div', { class: 'media-preview' }, [
            el('img', { attrs: { src: objectUrl, alt: file.path } }),
          ]),
        );
      } else if (file.kind === 'sound') {
        objectUrl = URL.createObjectURL(blob);
        contentHost.appendChild(
          el('div', { class: 'media-preview' }, [
            el('audio', { attrs: { controls: '', src: objectUrl } }),
          ]),
        );
      } else if (file.kind === 'font') {
        objectUrl = URL.createObjectURL(blob);
        const style = el('style', {});
        style.textContent = `@font-face{font-family:"a2w-preview-font";src:url("${objectUrl}");}`;
        document.head.appendChild(style);
        contentHost.append(
          el('div', { class: 'font-preview', attrs: { style: 'font-family:"a2w-preview-font", sans-serif' } }, [
            el('p', { text: 'ABCDEFGHIJKLM abcdefghijklm 0123456789' }),
            el('p', { text: 'La reconstruction web — APK2WEB' }),
          ]),
        );
        window.setTimeout(() => style.remove(), 5000);
      } else if (isEditable(file.kind) || file.mime.startsWith('text/')) {
        const text = state.edits[file.path] ?? (await blob.text());
        const shown = text.length > 400_000 ? `${text.slice(0, 400_000)}\n\n… (aperçu tronqué à 400 000 caractères ; le fichier complet reste stocké)` : text;
        contentHost.appendChild(el('pre', { class: 'code-preview', text: shown }));
        if (state.edits[file.path] !== undefined) {
          contentHost.appendChild(
            el('p', { class: 'note note--accent', text: 'Ce fichier a été modifié dans APK2WEB ; l’aperçu affiche votre version.' }),
          );
        }
      } else {
        contentHost.appendChild(
          el('div', { class: 'binary-preview' }, [
            htmlIcon('alert'),
            el('p', { text: `Aperçu indisponible pour ce format (${file.mime}).` }),
            el('p', { class: 'note', text: 'Le fichier est conservé dans le projet et peut être inclus dans l’export.' }),
          ]),
        );
      }
    } catch (error) {
      contentHost.appendChild(
        el('p', { class: 'note', text: error instanceof Error ? error.message : String(error) }),
      );
    }
  }

  /* ---------------------------------------------------------------- */
  /* Preview                                                           */
  /* ---------------------------------------------------------------- */
  function renderPreview(): HTMLElement {
    const wrap = el('div', { class: 'preview' });
    const device = DEVICES.find((entry) => entry.id === state.device) ?? DEVICES[0];
    const stage = el('div', { class: 'preview__stage' });
    const deviceHost = el('div', { class: `preview-device${device.id === 'auto' ? ' preview-device--auto' : ''}` });
    if (device.width) {
      deviceHost.setAttribute('style', `width:${device.width}px;height:${device.height}px`);
    }

    if (!state.build) {
      stage.appendChild(
        emptyState(
          'Aucun site généré',
          state.files.length === 0
            ? 'Importez un projet décompilé pour lancer l’analyse et la génération.'
            : 'Cliquez sur « Générer le site » pour reconstruire l’interface web.',
        ),
      );
    } else {
      const frame = el('iframe', {
        class: 'preview-frame',
        attrs: {
          sandbox: 'allow-scripts allow-forms allow-modals allow-popups',
          title: 'Aperçu du site reconstruit',
          referrerpolicy: 'no-referrer',
        },
      });
      previewFrame = frame;
      frame.srcdoc = state.previewHtml ?? state.build.previewHtml;
      deviceHost.appendChild(frame);
      stage.appendChild(deviceHost);
    }

    const deviceSelect = el('select', { class: 'field field--select', attrs: { 'aria-label': 'Taille d’écran simulée' } },
      DEVICES.map((entry) =>
        el('option', { text: entry.label, attrs: { value: entry.id, selected: entry.id === state.device } }),
      ),
    );
    deviceSelect.addEventListener('change', () => {
      state.device = deviceSelect.value;
      renderBody();
    });

    const toolbar = el('div', { class: 'preview__toolbar' }, [
      el('div', { class: 'preview__group' }, [
        el('span', { class: 'preview__label', html: icon('phone') }),
        deviceSelect,
      ]),
      el('div', { class: 'preview__group' }, [
        el('button', {
          class: 'icon-btn',
          title: 'Recharger l’aperçu',
          html: icon('refresh'),
          attrs: { type: 'button' },
          on: { click: () => reloadPreview() },
        }),
        el('button', {
          class: 'icon-btn',
          title: 'Plein écran',
          html: icon('expand'),
          attrs: { type: 'button' },
          on: {
            click: () => {
              if (deviceHost.requestFullscreen) void deviceHost.requestFullscreen();
            },
          },
        }),
        el('button', {
          class: 'btn btn--soft btn--small',
          attrs: { type: 'button' },
          html: `${icon('check')}<span>Tester l’exécution</span>`,
          on: { click: () => void runTest() },
        }),
      ]),
      el('span', { class: 'preview__hint', text: 'iframe isolée · sandbox · aucun accès au projet' }),
    ]);

    wrap.append(
      toolbar,
      state.build
        ? el('div', { class: `preview__banner preview__banner--${state.build.fidelity}` }, [
            el('strong', { text: state.build.fidelityLabel }),
            el('span', {
              text:
                ' · Reconstruction fidèle aux ressources, mais le code Android n’est pas exécuté et la logique métier n’est pas reproduite.',
            }),
          ])
        : el('div', { class: 'preview__banner' }),
      stage,
    );

    if (state.build && state.testReport) {
      wrap.appendChild(
        el('p', { class: 'note' }, [
          `Dernier test : ${state.testReport.screens.length} écran(s) rendu(s), ${state.testReport.actions} action(s), ${
            state.testReport.errors.length
          } erreur(s) JavaScript.`,
        ]),
      );
    }
    return wrap;
  }

  function reloadPreview(): void {
    if (!previewFrame || !state.build) return;
    previewFrame.srcdoc = state.previewHtml ?? state.build.previewHtml;
  }

  async function runTest(): Promise<void> {
    if (!state.build) {
      toast('Générez d’abord le site avant de le tester.', 'error');
      return;
    }
    state.tab = 'preview';
    renderTabs();
    renderBody();
    const release = busy('Test du site généré dans l’iframe…');
    log('info', 'test', 'Exécution du site généré dans l’iframe isolée.');
    const report = await new Promise<PreviewReport | null>((resolve) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        pendingTest = null;
        resolve(null);
      }, 9000);
      pendingTest = (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      };
      reloadPreview();
    });
    release();

    if (!report) {
      log('error', 'test', 'Aucune réponse du site généré (délai dépassé).');
      toast('Le test n’a pas abouti : aucune réponse de l’iframe.', 'error');
      return;
    }
    const expected = state.build.screens.length > 0 ? state.build.screens.length : 1;
    const rendered = report.screens.filter((screen) => screen.nodes > 2).length;
    const problems: string[] = [];
    if (report.errors.length > 0) problems.push(`${report.errors.length} erreur(s) JavaScript`);
    if (rendered < expected) problems.push(`${rendered}/${expected} écran(s) rendu(s)`);
    if (state.build.screens.length > 1 && !report.router) problems.push('routeur absent');

    if (problems.length === 0) {
      state.testedAt = Date.now();
      state.meta = { ...state.meta, status: 'tested', testedAt: state.testedAt, updatedAt: Date.now() };
      await saveProject(state.meta);
      log(
        'success',
        'test',
        `Test réussi : ${rendered}/${expected} écran(s) rendu(s), ${report.actions} action(s) détectée(s), 0 erreur.`,
      );
      toast('Test d’exécution réussi : le site généré s’affiche et répond.', 'success');
    } else {
      log('error', 'test', `Test incomplet : ${problems.join(' · ')}.`);
      for (const error of report.errors.slice(0, 5)) log('error', 'aperçu', error);
      toast(`Test incomplet : ${problems.join(' · ')}`, 'error');
    }
    renderHead();
    renderBody();
  }

  /* ---------------------------------------------------------------- */
  /* Editor                                                            */
  /* ---------------------------------------------------------------- */
  function renderEditor(): HTMLElement {
    const wrap = el('div', { class: 'editor' });
    const list = el('aside', { class: 'editor__list' });
    const host = el('div', { class: 'editor__main' });

    const generated = state.build?.files ?? [];
    if (generated.length > 0) {
      list.appendChild(el('h3', { text: 'Site généré' }));
      for (const file of generated) {
        list.appendChild(editorRow(file.path, 'generated', file.path, false));
      }
    }
    const sources = state.files.filter((file) => isEditable(file.kind)).slice(0, 400);
    if (sources.length > 0) {
      list.appendChild(el('h3', { text: 'Sources Android' }));
      for (const file of sources) {
        list.appendChild(editorRow(file.path, 'source', file.path, state.edits[file.path] !== undefined));
      }
    }
    if (generated.length === 0 && sources.length === 0) {
      list.appendChild(el('p', { class: 'note', text: 'Aucun fichier éditable.' }));
    }

    function editorRow(path: string, type: 'generated' | 'source', label: string, modified: boolean): HTMLElement {
      return el('button', {
        class: `editor-row${state.editorPath === path ? ' is-active' : ''}`,
        attrs: { type: 'button', title: path },
        html: `${icon(type === 'generated' ? 'code' : 'xml')}<span>${escapeText(label)}</span>${
          modified ? '<span class="dot-modified" title="modifié"></span>' : ''
        }`,
        on: {
          click: () => {
            void openEditorFile(path, type, host);
          },
        },
      });
    }

    host.appendChild(
      emptyState(
        'Éditeur de ressources',
        'Sélectionnez un fichier généré (HTML, CSS, JS) ou une ressource Android (strings.xml, couleurs, layout, Smali) pour le modifier. Les modifications sont conservées dans IndexedDB et réappliquées à chaque génération.',
      ),
    );

    if (state.editorPath) {
      const path = state.editorPath;
      if (generated.some((file) => file.path === path)) void openEditorFile(path, 'generated', host);
      else if (sources.some((file) => file.path === path)) void openEditorFile(path, 'source', host);
    }

    wrap.append(list, host);
    return wrap;
  }

  async function openEditorFile(
    path: string,
    type: 'generated' | 'source',
    main: HTMLElement,
  ): Promise<void> {
    if (state.editorDirty && state.editorPath && state.editorPath !== path) {
      const discard = await confirmDialog(
        'Modifications non enregistrées',
        'Le fichier en cours d’édition contient des modifications non enregistrées. Les abandonner ?',
        'Abandonner',
      );
      if (!discard) return;
    }
    if (state.editorPath === path && main.querySelector('.code-editor')) return;
    let text = '';
    if (type === 'generated') {
      text = state.build?.files.find((file) => file.path === path)?.text ?? '';
    } else {
      text = state.edits[path] ?? (await getFileText(state.projectId, path)) ?? '';
    }
    state.editorPath = path;
    state.editorText = text;
    state.editorDirty = false;
    for (const row of Array.from(document.querySelectorAll('.editor-row'))) {
      row.classList.toggle('is-active', row.getAttribute('title') === path);
    }
    clear(main);

    const textarea = el('textarea', {
      class: 'code-editor',
      attrs: { spellcheck: 'false', 'aria-label': `Éditer ${path}` },
    });
    textarea.value = text;
    textarea.addEventListener('input', () => {
      state.editorText = textarea.value;
      state.editorDirty = true;
      saveButton.disabled = textarea.value === text;
    });
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') {
        event.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = `${textarea.value.slice(0, start)}  ${textarea.value.slice(end)}`;
        textarea.selectionStart = start + 2;
        textarea.selectionEnd = start + 2;
        state.editorText = textarea.value;
        state.editorDirty = true;
        saveButton.disabled = false;
      }
    });

    const saveButton = el('button', {
      class: 'btn btn--primary btn--small',
      attrs: { type: 'button' },
      html: `${icon('check')}<span>Enregistrer</span>`,
    });
    saveButton.disabled = true;
    saveButton.addEventListener('click', async () => {
      await saveEdit(state.projectId, path, textarea.value);
      state.editorDirty = false;
      log('success', 'éditeur', `${path} enregistré.`);
      toast('Modifications enregistrées.', 'success');
      await runPipeline('edit');
    });

    const resetButton = el('button', {
      class: 'btn btn--ghost btn--small',
      attrs: { type: 'button' },
      text: 'Réinitialiser',
    });
    resetButton.addEventListener('click', async () => {
      if (state.edits[path] === undefined) {
        toast('Ce fichier n’a pas été modifié.', 'info');
        return;
      }
      await clearEdit(state.projectId, path);
      state.editorDirty = false;
      log('info', 'éditeur', `${path} réinitialisé à la version d’origine.`);
      await runPipeline('edit');
    });

    const readOnlyNote =
      type === 'generated'
        ? 'Fichier généré : vos modifications sont conservées et réappliquées à chaque génération.'
        : 'Fichier source : la version modifiée est utilisée par l’analyse et la génération.';

    main.append(
      el('div', { class: 'editor__head' }, [
        el('div', {}, [
          el('p', { class: 'file-preview__path', text: path }),
          el('p', { class: 'file-preview__meta', text: readOnlyNote }),
        ]),
        el('div', { class: 'editor__actions' }, [resetButton, saveButton]),
      ]),
      textarea,
    );
    textarea.focus();
  }

  /* ---------------------------------------------------------------- */
  /* Console                                                           */
  /* ---------------------------------------------------------------- */
  function renderConsole(): HTMLElement {
    const wrap = el('div', { class: 'console' });
    const filters = el('div', { class: 'console__filters' });
    const options: { id: LogLevel | 'all'; label: string }[] = [
      { id: 'all', label: 'Tout' },
      { id: 'info', label: 'Info' },
      { id: 'success', label: 'Succès' },
      { id: 'warn', label: 'Avertissements' },
      { id: 'error', label: 'Erreurs' },
    ];
    for (const option of options) {
      filters.appendChild(
        el('button', {
          class: `filter${consoleFilter === option.id ? ' is-active' : ''}`,
          attrs: { type: 'button' },
          text: option.label,
          on: {
            click: () => {
              consoleFilter = option.id;
              renderBody();
            },
          },
        }),
      );
    }
    wrap.append(
      el('div', { class: 'pane-toolbar' }, [
        el('div', { class: 'pane-toolbar__title' }, [buttonIcon('terminal'), el('span', { text: 'Console de diagnostic' })]),
        filters,
        el('button', {
          class: 'btn btn--ghost btn--small',
          attrs: { type: 'button' },
          text: 'Effacer',
          on: {
            click: () => {
              state.logs = [];
              renderBody();
            },
          },
        }),
      ]),
      el('div', { class: 'console__list', id: 'console-list' }),
    );
    renderConsoleEntries();
    return wrap;
  }

  function renderConsoleEntries(): void {
    const list = document.getElementById('console-list');
    if (!list) return;
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 30;
    clear(list);
    const entries = state.logs.filter((entry) => consoleFilter === 'all' || entry.level === consoleFilter);
    if (entries.length === 0) {
      list.appendChild(el('p', { class: 'note', text: 'Aucune entrée pour ce filtre.' }));
      return;
    }
    for (const entry of entries.slice(-250)) {
      list.appendChild(
        el('div', { class: `log log--${entry.level}` }, [
          el('span', { class: 'log__time', text: new Date(entry.at).toLocaleTimeString('fr-FR') }),
          el('span', { class: 'log__level', text: entry.level.toUpperCase() }),
          el('span', { class: 'log__source', text: entry.source }),
          el('span', { class: 'log__message', text: entry.message }),
        ]),
      );
    }
    if (atBottom) list.scrollTop = list.scrollHeight;
  }

  /* ---------------------------------------------------------------- */
  /* Report                                                            */
  /* ---------------------------------------------------------------- */
  function renderReport(): HTMLElement {
    const wrap = el('div', { class: 'report' });
    if (!state.build || !state.analysis) {
      wrap.appendChild(
        emptyState(
          'Rapport indisponible',
          state.files.length === 0
            ? 'Importez un projet pour obtenir l’analyse et le rapport de conversion.'
            : 'Lancez « Analyser » ou « Générer le site » pour produire le rapport.',
        ),
      );
      return wrap;
    }
    const build = state.build;
    const analysis = state.analysis;
    const converted = build.interactions.filter((interaction) => interaction.converted).length;

    wrap.appendChild(
      el('div', { class: `report__banner report__banner--${build.fidelity}` }, [
        el('div', {}, [
          el('p', { class: 'eyebrow', text: 'Niveau de fidélité' }),
          el('h2', { text: build.fidelityLabel }),
          el('p', {
            text:
              'Cette reconstruction est produite à partir des ressources et d’une analyse heuristique du Smali. Le bytecode Android n’est jamais exécuté, aucune règle métier n’est reproduite. Un test d’exécution vérifie uniquement le rendu HTML et l’absence d’erreurs JavaScript.',
          }),
        ]),
        el('button', {
          class: 'btn btn--soft',
          attrs: { type: 'button' },
          html: `${icon('check')}<span>Tester maintenant</span>`,
          on: { click: () => void runTest() },
        }),
      ]),
    );

    wrap.appendChild(
      el('div', { class: 'report__stats' }, [
        stat('Écrans', String(build.screens.length)),
        stat('Layouts analysés', String(analysis.stats.layouts)),
        stat('Interactions', `${converted}/${analysis.interactions.length}`),
        stat('Images', String(analysis.stats.images)),
        stat('Sons', String(analysis.stats.sounds)),
        stat('Polices', String(analysis.stats.fonts)),
      ]),
    );

    const capabilityHost = el('div', { class: 'capabilities' });
    for (const capability of build.capabilities) {
      capabilityHost.appendChild(
        el('div', { class: 'capability' }, [
          el('span', { class: `state state--${capability.state}`, text: stateLabel(capability.state) }),
          el('div', {}, [
            el('h3', { text: capability.label }),
            el('p', { text: capability.detail }),
          ]),
        ]),
      );
    }
    wrap.appendChild(
      el('section', { class: 'report__section' }, [
        el('h2', { text: 'Éléments reconstruits et éléments manquants' }),
        capabilityHost,
      ]),
    );

    if (analysis.engines.length > 0) {
      wrap.appendChild(
        el('section', { class: 'report__section' }, [
          el('h2', { text: 'Moteurs et frameworks détectés' }),
          el('div', { class: 'engines' }, analysis.engines.map((engine) =>
            el('div', { class: 'engine' }, [
              el('strong', { text: engine.label }),
              el('code', { text: engine.evidence }),
              el('span', {
                class: engine.blocksGameplay ? 'state state--unsupported' : 'state state--partial',
                text: engine.blocksGameplay ? 'Jeu non reconstructible' : 'Web embarqué',
              }),
            ]),
          )),
        ]),
      );
    }

    const issueDiagnostics = build.diagnostics.filter((diagnostic) => diagnostic.level !== 'info');
    wrap.appendChild(
      el('section', { class: 'report__section' }, [
        el('h2', { text: `Avertissements et erreurs (${issueDiagnostics.length})` }),
        issueDiagnostics.length === 0
          ? el('p', { class: 'note', text: 'Aucun avertissement bloquant.' })
          : el('div', { class: 'diagnostics' }, issueDiagnostics.slice(0, 60).map((diagnostic) =>
              el('div', { class: `diagnostic diagnostic--${diagnostic.level}` }, [
                el('span', { class: 'diagnostic__code', text: diagnostic.code }),
                el('div', {}, [
                  el('p', { text: diagnostic.message }),
                  diagnostic.detail ? el('p', { class: 'note', text: diagnostic.detail }) : null,
                ]),
              ]),
            )),
      ]),
    );

    wrap.appendChild(
      el('section', { class: 'report__section' }, [
        el('h2', { text: 'Écrans détectés' }),
        el('div', { class: 'screen-list' }, build.screens.length === 0
          ? [el('p', { class: 'note', text: 'Aucun écran reconstruit (ressources seulement).' })]
          : build.screens.map((screen) =>
              el('div', { class: 'screen-row' }, [
                el('strong', { text: screen.title }),
                el('code', { text: screen.layout }),
                el('span', { class: 'note', text: screen.activity ?? 'layout seul' }),
              ]),
            )),
      ]),
    );

    if (analysis.localizations.length > 0) {
      wrap.appendChild(
        el('p', { class: 'note' }, [
          `Traductions détectées (${analysis.localizations.length}) : ${analysis.localizations.join(', ')}. Seules les valeurs par défaut sont utilisées.`,
        ]),
      );
    }
    if (state.testedAt) {
      wrap.appendChild(
        el('p', { class: 'note note--accent', text: `Test d’exécution validé le ${formatDate(state.testedAt)}.` }),
      );
    }
    return wrap;
  }

  /* ---------------------------------------------------------------- */
  /* Export                                                            */
  /* ---------------------------------------------------------------- */
  async function runExport(): Promise<void> {
    if (!state.build) {
      await runPipeline('manual');
      if (!state.build) return;
    }
    const build = state.build;
    if (!build) return;
    const release = busy('Construction du ZIP APK2WEB…');
    try {
      const result = await exportSiteZip({
        build,
        readBlob: (path) => getFileBlob(state.projectId, path),
      });
      downloadBlob(result.blob, result.filename);
      log(
        'success',
        'export',
        `ZIP ${result.filename} : ${result.entries} entrées, ${formatBytes(result.bytes)}${
          result.missing.length ? `, ${result.missing.length} ressource(s) manquante(s)` : ''
        }.`,
      );
      if (result.missing.length > 0) {
        log('warn', 'export', `Fichiers non trouvés : ${result.missing.slice(0, 8).join(', ')}`);
      }
      toast(`Export prêt : ${result.filename} (${formatBytes(result.bytes)}).`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log('error', 'export', message);
      toast(`Export impossible : ${message}`, 'error');
    } finally {
      release();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Misc helpers                                                      */
  /* ---------------------------------------------------------------- */
  function stat(label: string, value: string): HTMLElement {
    return el('div', { class: 'stat' }, [
      el('span', { class: 'stat__value', text: value }),
      el('span', { class: 'stat__label', text: label }),
    ]);
  }
}

/* ------------------------------------------------------------------ */
/* Module helpers                                                      */
/* ------------------------------------------------------------------ */

function countFiles(folder: TreeFolder): number {
  let count = folder.files.length;
  for (const child of folder.folders.values()) count += countFiles(child);
  return count;
}

function isEditable(kind: FileKind): boolean {
  return kind === 'xml' || kind === 'text' || kind === 'smali';
}

function iconForKind(kind: FileKind | 'generated'): string {
  switch (kind) {
    case 'image':
      return 'image';
    case 'sound':
      return 'sound';
    case 'font':
      return 'font';
    case 'smali':
      return 'code';
    case 'native':
      return 'alert';
    case 'archive':
      return 'folder';
    default:
      return 'file';
  }
}

function stateLabel(state: string): string {
  switch (state) {
    case 'ok':
      return 'Reconstruit';
    case 'partial':
      return 'Partiel';
    case 'simulated':
      return 'Simulé';
    default:
      return 'Non converti';
  }
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlIcon(name: string): HTMLElement {
  return el('span', { class: 'icon icon--large', html: icon(name) });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Lecture du fichier impossible.'));
    reader.readAsDataURL(blob);
  });
}

function kindLabel(kind: FileKind): string {
  switch (kind) {
    case 'image':
      return 'Image';
    case 'sound':
      return 'Audio';
    case 'font':
      return 'Police';
    case 'xml':
      return 'XML';
    case 'smali':
      return 'Smali';
    case 'native':
      return 'Bibliothèque native';
    case 'archive':
      return 'Archive';
    case 'text':
      return 'Texte';
    default:
      return 'Fichier';
  }
}
