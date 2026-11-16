import { BufferGeometry } from 'three';

/**
 * A single loaded STL instance placed in the scene. Each model carries its
 * own transform so multiple STLs can coexist, be independently selected via
 * the `TransformControls` gizmo, and be priced individually before being
 * aggregated into the global quote.
 */
export interface PrintModel {
  id: string;
  name: string;
  geometry: BufferGeometry;
  scale: number;
  position: [number, number, number];
  rotation: [number, number, number];
  /** "X-Ray" toggle, scoped per-model so each object can be inspected independently. */
  isWireframe: boolean;
  /** Volume (cm3) at scale = 1, as reported by the volume worker. */
  baseVolumeCm3: number;
  /** Un-scaled bounding-box size (mm), as authored in the STL (post bed-alignment). */
  baseDimensionsMm: { x: number; y: number; z: number };
}

/** True when the model's scaled bounding box exceeds the printer's build volume on any axis. */
export function isModelOutOfBounds(model: PrintModel, printerVolumeMm: { x: number; y: number; z: number }): boolean {
  const d = model.baseDimensionsMm;
  const s = model.scale;
  return d.x * s > printerVolumeMm.x || d.y * s > printerVolumeMm.y || d.z * s > printerVolumeMm.z;
}
