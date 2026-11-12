import { el } from './dom';
import { renderDashboard } from './dashboard';
import { renderWorkspace } from './workspace';

export function navigate(path: string): void {
  window.location.hash = path;
}

export function mountApp(root: HTMLElement): void {
  root.classList.remove('app-loading');
  root.textContent = '';

  const view = el('main', { class: 'view', id: 'view' });
  const shell = el('div', { class: 'shell' }, [
    el('header', { class: 'topbar' }, [
      el('a', {
        class: 'brand',
        html: 'APK<span>2</span>WEB',
        attrs: { href: '#/', 'aria-label': 'APK2WEB — accueil' },
      }),
      el('nav', { class: 'topbar__nav' }, [
        el('a', { class: 'topbar__link', text: 'Projets', attrs: { href: '#/' } }),
        el('span', { class: 'topbar__badge', text: '100 % local — IndexedDB' }),
      ]),
    ]),
    view,
    el('footer', { class: 'site-footer' }, [
      el('span', {
        text: 'APK2WEB reconstruit des interfaces web à partir de ressources Android. Aucun code Android n’est exécuté.',
      }),
      el('span', { class: 'site-footer__sep', text: '·' }),
      el('span', { text: 'À utiliser uniquement sur des applications dont vous détenez les droits.' }),
    ]),
  ]);
  root.appendChild(shell);

  const render = async (): Promise<void> => {
    const hash = window.location.hash.replace(/^#/, '') || '/';
    const match = /^\/p\/([^/]+)$/.exec(hash);
    view.textContent = '';
    try {
      if (match) {
        await renderWorkspace(view, decodeURIComponent(match[1]));
      } else {
        await renderDashboard(view);
      }
    } catch (error) {
      view.appendChild(
        el('div', { class: 'panel error-panel' }, [
          el('h2', { text: 'Une erreur est survenue' }),
          el('p', {
            text:
              error instanceof Error
                ? error.message
                : String(error),
          }),
          el('button', {
            class: 'btn btn--ghost',
            text: 'Revenir au tableau de bord',
            on: { click: () => navigate('/') },
          }),
        ]),
      );
      console.error(error);
    }
    window.scrollTo({ top: 0 });
  };

  window.addEventListener('hashchange', () => {
    void render();
  });
  void render();
}
