import { el } from './dom';

let overlay: HTMLElement | null = null;
let counter = 0;

export function busy(label: string): () => void {
  counter += 1;
  if (!overlay) {
    overlay = el('div', { class: 'busy', attrs: { role: 'status', 'aria-live': 'polite' } }, [
      el('div', { class: 'busy__card' }, [
        el('div', { class: 'spinner', attrs: { 'aria-hidden': 'true' } }),
        el('p', { class: 'busy__label', text: label }),
      ]),
    ]);
    document.body.appendChild(overlay);
  } else {
    const text = overlay.querySelector('.busy__label');
    if (text) text.textContent = label;
  }
  requestAnimationFrame(() => overlay?.classList.add('is-visible'));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    counter = Math.max(0, counter - 1);
    if (counter === 0 && overlay) {
      overlay.classList.remove('is-visible');
      const node = overlay;
      overlay = null;
      window.setTimeout(() => node.remove(), 200);
    }
  };
}
