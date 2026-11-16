import { Injectable, signal } from '@angular/core';
import { PrintModel } from '../models/print-model.model';

export type TransformMode = 'translate' | 'rotate' | 'scale';

export interface ModelTransformPatch {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}

/**
 * `angular-three` instantiates the scene graph component dynamically
 * (inside `<ngt-canvas>`), so it can't receive `@Input()`s directly from
 * its host's template. This service is provided on the host component and
 * injected by both sides to bridge reactive state across that boundary.
 */
@Injectable()
export class PrintSceneBridge {
  /** All loaded models, written down by the host; the scene graph only reads this. */
  readonly models = signal<PrintModel[]>([]);
  /** Which model's gizmo is active, written down by the host; the scene graph only reads this. */
  readonly selectedModelId = signal<string | null>(null);
  /** Active TransformControls mode, written down by the host. */
  readonly transformMode = signal<TransformMode>('translate');
  /** Printer build volume (mm). `y` is the Z-height limit (three.js is Y-up). */
  readonly printerVolumeMm = signal({ x: 220, y: 250, z: 220 });
  /** Global "X-Ray" override, written down by the host; forces every model to render as wireframe regardless of its own per-model toggle. */
  readonly isWireframe = signal(false);
  /** Written once by the scene graph so the host can capture a PNG snapshot for PDF export. */
  readonly canvasElement = signal<HTMLCanvasElement | null>(null);

  /** Written by the scene graph on mesh/background click; the host reads it to update `selectedModelId`. */
  readonly selectRequest = signal<string | null>(null);
  /** Written by the scene graph while the TransformControls gizmo is dragged; the host reads it to persist the model's transform. */
  readonly transformRequest = signal<ModelTransformPatch | null>(null);

  /** Mesh click handler bound in the scene template: selects the model and stops the ray from also hitting the backdrop. */
  selectModel(id: string | null, event?: { stopPropagation?: () => void }): void {
    event?.stopPropagation?.();
    this.selectRequest.set(id);
  }
}
