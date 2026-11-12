/** Types shared by the importer, the analyzer, the generator and the UI. */

export type FileKind =
  | 'image'
  | 'sound'
  | 'font'
  | 'xml'
  | 'smali'
  | 'native'
  | 'text'
  | 'archive'
  | 'other';

export type LogLevel = 'info' | 'success' | 'warn' | 'error';

/** How faithful the generated site is. Never "complete": Android logic is not executed. */
export type Fidelity = 'interactive' | 'interface' | 'assets';

export type ProjectStatus = 'empty' | 'imported' | 'generated' | 'tested';

export interface ImportedFile {
  path: string;
  blob: Blob;
  size: number;
  kind: FileKind;
  mime: string;
}

export interface StoredFile {
  projectId: string;
  path: string;
  kind: FileKind;
  mime: string;
  size: number;
  blob: Blob;
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  fileCount: number;
  totalSize: number;
  packageName?: string;
  appLabel?: string;
  versionName?: string;
  status: ProjectStatus;
  fidelity?: Fidelity;
  fidelityLabel?: string;
  screenCount?: number;
  issueCount?: number;
  testedAt?: number;
  engineLabel?: string;
}

export interface Diagnostic {
  level: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  detail?: string;
}

export type CapabilityState = 'ok' | 'partial' | 'simulated' | 'unsupported';

export interface Capability {
  key: string;
  label: string;
  state: CapabilityState;
  detail: string;
}

export interface LogEntry {
  id: string;
  at: number;
  level: LogLevel;
  source: string;
  message: string;
}

/* ------------------------------------------------------------------ */
/* Analyzer model                                                      */
/* ------------------------------------------------------------------ */

export interface ViewNode {
  tag: string;
  id?: string;
  attrs: Record<string, string>;
  children: ViewNode[];
  /** for <include layout="@layout/x"> */
  include?: string;
}

export interface ScreenSpec {
  id: string;
  layout: string;
  activity?: string;
  title: string;
  root: ViewNode;
  origin: 'activity' | 'layout';
}

export type InteractionAction =
  | 'navigate'
  | 'back'
  | 'toggle'
  | 'notify'
  | 'sound'
  | 'unknown';

export interface InteractionSpec {
  screenId: string;
  viewId?: string;
  handler: string;
  action: InteractionAction;
  target?: string;
  targetActivity?: string;
  label: string;
  converted: boolean;
}

export interface EngineDetection {
  key: string;
  label: string;
  evidence: string;
  /** true when the runtime cannot possibly be reproduced in a browser. */
  blocksGameplay: boolean;
}

export interface DrawableShape {
  kind: 'shape';
  solid?: string;
  strokeColor?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  gradientColors?: string[];
  gradientDirection?: string;
}

export interface DrawableRef {
  name: string;
  kind: 'image' | 'shape' | 'missing' | 'xml';
  path?: string;
  shape?: DrawableShape;
}

export interface AssetEntry {
  path: string;
  name: string;
  size: number;
}

export interface ActivityInfo {
  className: string;
  layout?: string;
  label?: string;
}

export interface AnalysisStats {
  layouts: number;
  activities: number;
  smaliFiles: number;
  images: number;
  sounds: number;
  fonts: number;
  nativeLibs: number;
  xmlFiles: number;
  totalFiles: number;
  totalBytes: number;
}

export interface Analysis {
  projectName: string;
  packageName: string;
  appLabel: string;
  versionName?: string;
  versionCode?: string;
  launcherActivity?: string;
  permissions: string[];
  isApkOnly: boolean;
  manifestSkipped?: string;

  screens: ScreenSpec[];
  activities: ActivityInfo[];
  interactions: InteractionSpec[];

  strings: Record<string, string>;
  colors: Record<string, string>;
  dimens: Record<string, string>;
  arrays: Record<string, string[]>;
  drawables: Record<string, DrawableRef>;
  /** Every parsed layout, used to expand <include> tags. */
  layoutMap: Record<string, ViewNode>;
  publicIds: Record<string, { type: string; name: string }>;

  images: AssetEntry[];
  sounds: AssetEntry[];
  fonts: AssetEntry[];

  engines: EngineDetection[];
  capabilities: Capability[];
  diagnostics: Diagnostic[];
  stats: AnalysisStats;
  localizations: string[];
}
