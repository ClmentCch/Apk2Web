type Attrs = Record<string, string | number | boolean | null | undefined>;

export interface ElOptions {
  class?: string;
  id?: string;
  text?: string;
  html?: string;
  title?: string;
  attrs?: Attrs;
  on?: Partial<Record<string, (event: Event) => void>>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  children: (Node | string | number | null | undefined | false)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.id) node.id = options.id;
  if (options.title) node.title = options.title;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.html !== undefined) node.innerHTML = options.html;
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      if (value === null || value === undefined || value === false) continue;
      node.setAttribute(key, String(value));
    }
  }
  if (options.on) {
    for (const [event, handler] of Object.entries(options.on)) {
      if (handler) node.addEventListener(event, handler as EventListener);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' || typeof child === 'number' ? String(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

let toastHost: HTMLElement | null = null;

export function toast(message: string, level: 'info' | 'success' | 'error' = 'info'): void {
  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host' });
    document.body.appendChild(toastHost);
  }
  const entry = el('div', { class: `toast toast--${level}`, text: message });
  toastHost.appendChild(entry);
  window.setTimeout(() => entry.classList.add('is-visible'), 20);
  window.setTimeout(() => {
    entry.classList.remove('is-visible');
    window.setTimeout(() => entry.remove(), 250);
  }, 4200);
}

export function icon(name: string): string {
  const paths: Record<string, string> = {
    folder:
      '<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2.5h7.5A2.5 2.5 0 0 1 21 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
    file: '<path d="M6 3.5h7l5 5v12H6z"/><path d="M13 3.5v5h5"/>',
    image:
      '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 18l5.5-5.5 4 4L17 13l3 3"/>',
    sound:
      '<path d="M4 10v4h3l4 3.5v-15L7 10z"/><path d="M15 9a4 4 0 0 1 0 6"/><path d="M17.5 6.5a7.5 7.5 0 0 1 0 11"/>',
    font: '<path d="M5 20l6-15h2l6 15"/><path d="M8 14h8"/>',
    code: '<path d="M8 8l-4 4 4 4"/><path d="M16 8l4 4-4 4"/><path d="M13 5l-2 14"/>',
    upload: '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v3.5h16V16"/>',
    download: '<path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M4 19.5h16"/>',
    play: '<path d="M7 4.5l12 7.5-12 7.5z"/>',
    refresh:
      '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4h-4"/>',
    expand: '<path d="M4 9V4h5"/><path d="M20 15v5h-5"/><path d="M4 15v5h5"/><path d="M20 9V4h-5"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/>',
    check: '<path d="M4 12.5l5 5L20 6.5"/>',
    alert: '<path d="M12 3l9 16H3z"/><path d="M12 9v5"/><path d="M12 17.5v.5"/>',
    terminal: '<path d="M4 5h16v14H4z"/><path d="M7 10l3 2.5L7 15"/><path d="M12 15h5"/>',
    chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
    grid: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
    arrowLeft: '<path d="M15 5l-7 7 7 7"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    tablet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M11 18h2"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5v.5"/>',
  };
  const path = paths[name] ?? paths.file;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

export function buttonIcon(name: string): HTMLElement {
  return el('span', { class: 'icon', html: icon(name) });
}

export function askName(defaultName = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const input = el('input', {
      class: 'field',
      attrs: { type: 'text', placeholder: 'ex. MonProjet', maxlength: 80, value: defaultName },
    });
    const form = el('form', {
      class: 'dialog-card',
      attrs: { method: 'dialog' },
      on: {
        submit: (event) => {
          event.preventDefault();
          const value = input.value.trim();
          if (!value) {
            input.focus();
            return;
          }
          dialog.close();
          resolve(value);
        },
      },
    }, [
      el('h2', { text: 'Nouveau projet' }),
      el('p', { class: 'dialog-sub', text: 'Le projet et ses fichiers restent stockés localement dans votre navigateur (IndexedDB).' }),
      input,
      el('div', { class: 'dialog-actions' }, [
        el('button', {
          class: 'btn btn--ghost',
          text: 'Annuler',
          attrs: { type: 'button' },
          on: {
            click: () => {
              dialog.close();
              resolve(null);
            },
          },
        }),
        el('button', { class: 'btn btn--primary', text: 'Créer le projet', attrs: { type: 'submit' } }),
      ]),
    ]);
    const dialog = el('dialog', { class: 'dialog' }, [form]);
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(null);
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    window.setTimeout(() => input.focus(), 30);
  });
}

export function confirmDialog(title: string, message: string, confirmLabel = 'Confirmer'): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const finish = (value: boolean): void => {
      if (answered) return;
      answered = true;
      dialog.close();
      resolve(value);
    };
    const dialog = el('dialog', { class: 'dialog' }, [
      el('div', { class: 'dialog-card' }, [
        el('h2', { text: title }),
        el('p', { class: 'dialog-sub', text: message }),
        el('div', { class: 'dialog-actions' }, [
          el('button', {
            class: 'btn btn--ghost',
            text: 'Annuler',
            attrs: { type: 'button' },
            on: { click: () => finish(false) },
          }),
          el('button', {
            class: 'btn btn--danger',
            text: confirmLabel,
            attrs: { type: 'button' },
            on: { click: () => finish(true) },
          }),
        ]),
      ]),
    ]);
    dialog.addEventListener('close', () => {
      dialog.remove();
      finish(false);
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

export function emptyState(title: string, message: string): HTMLElement {
  return el('div', { class: 'empty' }, [
    el('h3', { text: title }),
    el('p', { text: message }),
  ]);
}
