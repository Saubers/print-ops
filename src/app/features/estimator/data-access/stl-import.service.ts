import { Injectable } from '@angular/core';
import { BufferGeometry, Vector3 } from 'three';
import { STLLoader } from 'three-stdlib';

export interface StlImportResult {
  geometry: BufferGeometry;
  /** Un-scaled bounding-box size (mm), as authored in the STL. */
  size: { x: number; y: number; z: number };
}

/** Parses dropped/selected .stl files into a ready-to-render BufferGeometry. */
@Injectable({ providedIn: 'root' })
export class StlImportService {
  private readonly loader = new STLLoader();

  async loadFile(file: File): Promise<StlImportResult> {
    const buffer = await file.arrayBuffer();
    const geometry = this.loader.parse(buffer);

    geometry.computeVertexNormals();
    geometry.center();

    geometry.computeBoundingBox();
    const bbox = geometry.boundingBox!;

    // center() places the bbox midpoint at the origin, leaving bbox.min.y
    // negative. Translating up by -min.y rests the base exactly on Y=0
    // instead of intersecting the bed grid.
    geometry.translate(0, -bbox.min.y, 0);

    const size = new Vector3();
    bbox.getSize(size);

    // Keep the cached box in sync with the new position for any later consumer.
    geometry.computeBoundingBox();

    return { geometry, size: { x: size.x, y: size.y, z: size.z } };
  }
}
