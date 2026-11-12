import { cssColor, cssDimension } from './files';
import type { DrawableShape, ViewNode } from './types';

export const ANDROID_NS = 'http://schemas.android.com/apk/res/android';

export function parseXml(text: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) return null;
    if (!doc.documentElement) return null;
    return doc;
  } catch {
    return null;
  }
}

/** Read an Android attribute whatever prefix the decompiler used. */
export function androidAttr(el: Element, name: string): string | undefined {
  const direct = el.getAttribute(`android:${name}`);
  if (direct !== null) return direct;
  const ns = el.getAttributeNS(ANDROID_NS, name);
  if (ns !== null) return ns;
  const app = el.getAttribute(`app:${name}`);
  if (app !== null) return app;
  for (const attr of Array.from(el.attributes)) {
    if (attr.localName === name) return attr.value;
  }
  return undefined;
}

export function normalizeTag(tag: string): string {
  const clean = tag.trim();
  if (!clean.includes('.')) return clean;
  return clean.slice(clean.lastIndexOf('.') + 1);
}

export function normalizeClassName(name: string, pkg: string): string {
  if (name.startsWith('.')) return `${pkg}${name}`;
  if (!name.includes('.')) return pkg ? `${pkg}.${name}` : name;
  return name;
}

export function classToSmaliPath(className: string): string {
  return `${className.replace(/\./g, '/')}.smali`;
}

/** Resolve @string/… references. */
export function resolveStringRef(
  value: string | undefined,
  strings: Record<string, string>,
  depth = 0,
): string | undefined {
  if (value === undefined) return undefined;
  const raw = value.trim();
  if (!raw) return '';
  if (raw.startsWith('@string/')) {
    const key = raw.slice('@string/'.length);
    const hit = strings[key];
    if (hit !== undefined) return depth < 4 ? resolveStringRef(hit, strings, depth + 1) : hit;
    return undefined;
  }
  if (raw.startsWith('@android:string/')) return undefined;
  if (raw.startsWith('@')) return undefined;
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\@/g, '@');
}

/** Resolve @color/… and @android:color/… to a raw color value. */
export function resolveColorRef(
  value: string | undefined,
  colors: Record<string, string>,
  depth = 0,
): string | undefined {
  if (!value) return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  if (raw.startsWith('@color/')) {
    const key = raw.slice('@color/'.length);
    const hit = colors[key];
    if (hit === undefined) return undefined;
    return depth < 4 ? resolveColorRef(hit, colors, depth + 1) : hit;
  }
  if (raw.startsWith('@android:color/')) {
    const key = raw.slice('@android:color/'.length).toLowerCase();
    const system: Record<string, string> = {
      white: '#ffffffff',
      black: '#ff000000',
      transparent: '#00000000',
      holo_blue_dark: '#ff0099cc',
      holo_blue_light: '#ff33b5e5',
      darker_gray: '#ff444444',
    };
    return system[key];
  }
  if (raw.startsWith('?') || raw.startsWith('@')) return undefined;
  return cssColor(raw) ?? raw;
}

export function resolveDimensionRef(
  value: string | undefined,
  dimens: Record<string, string>,
  depth = 0,
): string | undefined {
  if (!value) return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  if (raw.startsWith('@dimen/')) {
    const key = raw.slice('@dimen/'.length);
    const hit = dimens[key];
    if (hit === undefined) return undefined;
    return depth < 4 ? resolveDimensionRef(hit, dimens, depth + 1) : hit;
  }
  if (raw.startsWith('@android:dimen/')) return undefined;
  if (raw.startsWith('@') || raw.startsWith('?')) return undefined;
  return raw;
}

/** fontFamily / style name -> CSS font-family and weight. */
export function fontFamilyCss(value: string | undefined): { family?: string; weight?: string } {
  if (!value) return {};
  const raw = value.trim().toLowerCase();
  if (!raw) return {};
  if (raw.includes('monospace')) return { family: '"JetBrains Mono", "Courier New", monospace' };
  if (raw.includes('serif') && !raw.includes('sans')) return { family: 'Georgia, "Times New Roman", serif' };
  if (raw.includes('cursive')) return { family: '"Segoe Script", cursive' };
  if (raw.includes('medium')) return { family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', weight: '500' };
  if (raw.includes('bold') || raw.includes('black')) return { family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', weight: '700' };
  if (raw.includes('light') || raw.includes('thin')) return { family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', weight: '300' };
  return { family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' };
}

/** Parse a res/drawable/shape.xml into a small CSS-able model. */
export function parseShapeDrawable(text: string): DrawableShape {
  const shape: DrawableShape = { kind: 'shape' };
  const doc = parseXml(text);
  if (!doc) return shape;
  const root = doc.documentElement;
  const solid = findByTag(root, 'solid');
  if (solid) shape.solid = androidAttr(solid, 'color');
  const corners = findByTag(root, 'corners');
  if (corners) {
    const radius = androidAttr(corners, 'radius');
    if (radius) {
      const css = cssDimension(radius);
      if (css) shape.cornerRadius = parseFloat(css);
    }
  }
  const stroke = findByTag(root, 'stroke');
  if (stroke) {
    shape.strokeColor = androidAttr(stroke, 'color');
    const width = androidAttr(stroke, 'width');
    if (width) {
      const css = cssDimension(width);
      if (css) shape.strokeWidth = parseFloat(css);
    }
  }
  const gradient = findByTag(root, 'gradient');
  if (gradient) {
    const start = androidAttr(gradient, 'startColor');
    const end = androidAttr(gradient, 'endColor');
    const center = androidAttr(gradient, 'centerColor');
    const colors = [start, center, end].filter((c): c is string => Boolean(c));
    if (colors.length > 0) shape.gradientColors = colors;
    const angle = androidAttr(gradient, 'angle');
    if (angle) shape.gradientDirection = angle;
  }
  return shape;
}

function findByTag(root: Element, tag: string): Element | undefined {
  const all = Array.from(root.getElementsByTagName('*'));
  return all.find((el) => el.localName === tag);
}

export function parseLayoutXml(text: string): ViewNode | null {
  const doc = parseXml(text);
  if (!doc) return null;
  let root: Element = doc.documentElement;
  if (!root) return null;
  if (root.localName === 'layout') {
    const child = Array.from(root.children).find(
      (el) => el.localName !== 'data' && el.localName !== 'variable' && el.localName !== 'import',
    );
    if (!child) return null;
    root = child;
  }
  return parseViewElement(root);
}

const NON_VIEW = new Set(['data', 'variable', 'import', 'requestFocus', 'tag', 'arguments']);

function parseViewElement(el: Element): ViewNode | null {
  const tag = normalizeTag(el.localName);
  if (NON_VIEW.has(tag)) return null;
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.localName === 'class') attrs.class = attr.value;
    else attrs[attr.localName] = attr.value;
  }
  const idRaw = attrs.id;
  const id = idRaw ? idRaw.replace(/^@\+?id\//, '') : undefined;
  const effectiveTag = tag === 'view' && attrs.class ? normalizeTag(attrs.class) : tag;
  if (effectiveTag === 'include') {
    const include = (attrs.layout ?? '').replace(/^@layout\//, '');
    return { tag: 'include', attrs, children: [], include };
  }
  const children: ViewNode[] = [];
  for (const child of Array.from(el.children)) {
    const node = parseViewElement(child);
    if (node) children.push(node);
  }
  return { tag: effectiveTag, id, attrs, children };
}

/** Collect the set of Android container classes used by parsed layouts. */
export function walkViews(node: ViewNode, visit: (node: ViewNode, parent?: ViewNode) => void, parent?: ViewNode): void {
  visit(node, parent);
  for (const child of node.children) walkViews(child, visit, node);
}
