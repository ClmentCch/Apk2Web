import { deleteProject, listProjects, saveProject, addFiles } from '../lib/db';
import { formatBytes } from '../lib/files';
import { ingestFromDataTransfer, ingestFromFileList } from '../lib/ingest';
import type { ImportedFile, ProjectMeta } from '../lib/types';
import { navigate } from './app';
import { busy } from './busy';
import { askName, confirmDialog, el, formatDate, icon, toast } from './dom';

export async function renderDashboard(view: HTMLElement): Promise<void> {
  const projects = await listProjects();
  const totalFiles = projects.reduce((sum, project) => sum + project.fileCount, 0);
  const totalSize = projects.reduce((sum, project) => sum + project.totalSize, 0);

  const fileInput = el('input', {
    attrs: {
      type: 'file',
      accept: '.zip,.apk,.aab,.xapk,application/zip,application/vnd.android.package-archive',
      multiple: true,
      hidden: true,
    },
  });
  const folderInput = el('input', {
    attrs: { type: 'file', webkitdirectory: '', directory: '', multiple: true, hidden: true },
  });
  fileInput.addEventListener('change', () => {
    const files = fileInput.files;
    if (files && files.length > 0) void startImport(() => ingestFromFileList(files));
    fileInput.value = '';
  });
  folderInput.addEventListener('change', () => {
    const files = folderInput.files;
    if (files && files.length > 0) void startImport(() => ingestFromFileList(files));
    folderInput.value = '';
  });

  const metrics = el('div', { class: 'metrics' }, [
    metric('Projets', String(projects.length)),
    metric('Fichiers stockés', totalFiles.toLocaleString('fr-FR')),
    metric('Volume local', formatBytes(totalSize)),
  ]);

  const dropzone = buildDropzone(
    () => fileInput.click(),
    () => folderInput.click(),
  );

  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragover');
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) return;
    void startImport(() => ingestFromDataTransfer(dataTransfer));
  });

  view.appendChild(
    el('section', { class: 'hero' }, [
      el('div', { class: 'hero__intro' }, [
        el('p', { class: 'eyebrow', text: 'Android → Web' }),
        el('h1', {}, [
          'Reconstruisez une ',
          el('em', { text: 'expérience web' }),
          ' à partir de vos ressources Android.',
        ]),
        el('p', {
          class: 'lede',
          text:
            'Importez un ZIP décompilé (apktool), un dossier Smali/res/assets ou un APK. APK2WEB analyse les layouts, les ressources et les handlers Smali, puis génère un site HTML/CSS/JS autonome. Aucun bytecode Android n’est exécuté : la conversion est honnêtement signalée comme une reconstruction.',
        }),
        el('div', { class: 'hero__actions' }, [
          el('button', {
            class: 'btn btn--primary',
            attrs: { type: 'button' },
            html: `${icon('plus')}<span>Nouveau projet</span>`,
            on: {
              click: () => {
                void createProject();
              },
            },
          }),
          el('button', {
            class: 'btn btn--ghost',
            attrs: { type: 'button' },
            html: `${icon('folder')}<span>Importer un projet</span>`,
            on: { click: () => fileInput.click() },
          }),
        ]),
        metrics,
      ]),
      dropzone,
      el('p', { class: 'hint' }, [
        'ZIP / APK : glissez le fichier. Dossier : glissez-le ou utilisez « Parcourir un dossier » (Chrome, Edge, Safari récent). ',
        'Les fichiers restent dans votre navigateur — rien n’est envoyé sur un serveur.',
      ]),
      fileInput,
      folderInput,
    ]),
  );

  const grid = el('div', { class: 'project-grid' });
  view.appendChild(
    el('section', { class: 'projects-section' }, [
      el('div', { class: 'section-head' }, [
        el('h2', { text: 'Projets récents' }),
        el('span', { class: 'section-count', text: `${projects.length} projet(s)` }),
      ]),
      projects.length === 0
        ? el('div', { class: 'empty empty--panel' }, [
            el('h3', { text: 'Aucun projet pour le moment' }),
            el('p', {
              text: 'Créez un projet vide puis importez vos fichiers, ou déposez directement une archive dans la zone ci-dessus.',
            }),
          ])
        : grid,
    ]),
  );

  for (const project of projects) {
    grid.appendChild(projectCard(project, () => void refresh()));
  }

  async function refresh(): Promise<void> {
    view.textContent = '';
    await renderDashboard(view);
  }

  async function createProject(): Promise<void> {
    const name = await askName();
    if (!name) return;
    const meta = newProjectMeta(name, []);
    await saveProject(meta);
    navigate(`/p/${meta.id}`);
  }

  async function startImport(run: () => ReturnType<typeof ingestFromFileList>): Promise<void> {
    const release = busy('Import des fichiers…');
    try {
      const result = await run();
      if (result.files.length === 0) {
        for (const warning of result.warnings.slice(0, 3)) toast(warning, 'error');
        toast("Aucun fichier exploitable n'a été importé.", 'error');
        return;
      }
      const suggested =
        result.archives.length > 0
          ? result.archives[0].replace(/\.(zip|apk|aab|xapk)$/i, '')
          : result.files[0].path.split('/')[0] || 'Projet Android';
      const name = await askName(suggested);
      if (!name) return;
      const meta = newProjectMeta(name, result.files);
      await saveProject(meta);
      await addFiles(meta.id, result.files);
      for (const warning of result.warnings.slice(0, 2)) toast(warning, 'info');
      toast(`${result.files.length} fichier(s) importé(s).`, 'success');
      navigate(`/p/${meta.id}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      release();
    }
  }
}

function newProjectMeta(name: string, files: ImportedFile[]): ProjectMeta {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    fileCount: files.length,
    totalSize: files.reduce((sum, file) => sum + file.size, 0),
    status: files.length > 0 ? 'imported' : 'empty',
  };
}

function metric(label: string, value: string): HTMLElement {
  return el('div', { class: 'metric' }, [
    el('span', { class: 'metric__value', text: value }),
    el('span', { class: 'metric__label', text: label }),
  ]);
}

function buildDropzone(onFiles: () => void, onFolder: () => void): HTMLElement {
  return el('div', { class: 'dropzone', attrs: { tabindex: 0 } }, [
    el('div', { class: 'dropzone__icon', html: icon('upload') }),
    el('h2', { text: 'Glissez votre projet ici' }),
    el('p', { text: 'APK, ZIP décompilé (smali/, res/, assets/, lib/…) ou dossier complet.' }),
    el('div', { class: 'dropzone__actions' }, [
      el('button', {
        class: 'btn btn--soft',
        attrs: { type: 'button' },
        text: 'Choisir un fichier',
        on: { click: onFiles },
      }),
      el('button', {
        class: 'btn btn--ghost',
        attrs: { type: 'button' },
        text: 'Parcourir un dossier',
        on: { click: onFolder },
      }),
    ]),
    el('p', { class: 'dropzone__meta', text: 'Traitement 100 % local · ZIP, APK, dossiers · 768 Mo max' }),
  ]);
}

function projectCard(project: ProjectMeta, refresh: () => void): HTMLElement {
  const statusLabel =
    project.status === 'tested'
      ? 'Testé'
      : project.status === 'generated'
        ? 'Généré'
        : project.status === 'imported'
          ? 'Importé'
          : 'Vide';
  const card = el('article', { class: 'project-card' }, [
    el('div', { class: 'project-card__top' }, [
      el('span', { class: `status status--${project.status}` }, [
        el('span', { class: 'status__dot' }),
        statusLabel,
      ]),
      el('span', { class: 'project-card__date', text: formatDate(project.updatedAt) }),
    ]),
    el('h3', { text: project.name }),
    el('p', { class: 'project-card__meta' }, [
      project.packageName ? `${project.packageName} · ` : '',
      `${project.fileCount.toLocaleString('fr-FR')} fichiers · ${formatBytes(project.totalSize)}`,
    ]),
    project.fidelityLabel
      ? el('p', { class: 'project-card__fidelity', text: project.fidelityLabel })
      : el('p', { class: 'project-card__fidelity project-card__fidelity--muted', text: 'Non généré' }),
    el('div', { class: 'project-card__actions' }, [
      el('button', {
        class: 'btn btn--soft',
        text: 'Ouvrir',
        attrs: { type: 'button' },
        on: { click: () => navigate(`/p/${project.id}`) },
      }),
      el('button', {
        class: 'icon-btn icon-btn--danger',
        html: icon('trash'),
        title: 'Supprimer le projet',
        attrs: { type: 'button', 'aria-label': `Supprimer ${project.name}` },
        on: {
          click: async () => {
            const confirmed = await confirmDialog(
              'Supprimer le projet ?',
              `« ${project.name} » et tous ses fichiers importés seront supprimés de ce navigateur. Cette action est irréversible.`,
              'Supprimer',
            );
            if (!confirmed) return;
            await deleteProject(project.id);
            toast('Projet supprimé.', 'info');
            refresh();
          },
        },
      }),
    ]),
  ]);
  card.addEventListener('dblclick', () => navigate(`/p/${project.id}`));
  return card;
}
