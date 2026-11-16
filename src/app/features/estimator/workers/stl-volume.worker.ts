/// <reference lib="webworker" />

/**
 * Request/response contracts for the volume worker.
 * `positions`/`index` are transferred (not copied) for zero-copy performance
 * on large STL meshes.
 */
export interface StlVolumeRequest {
  id: number;
  positions: Float32Array;
  /** null for non-indexed geometries (every 3 positions form a triangle) */
  index: Uint32Array | null;
}

export interface StlVolumeResponse {
  id: number;
  /** Present on success; absent when `error` is set. */
  volumeCm3?: number;
  /** Present when the geometry's math couldn't be computed (e.g. a malformed/corrupted STL). */
  error?: string;
}

/**
 * Signed volume of the tetrahedron formed by the triangle (a, b, c) and the origin.
 * V = (a . (b x c)) / 6
 */
function signedTetrahedronVolume(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  return (
    ax * (by * cz - bz * cy) -
    ay * (bx * cz - bz * cx) +
    az * (bx * cy - by * cx)
  ) / 6;
}

/**
 * Walks every triangle of the geometry and sums signed tetrahedron volumes.
 * For a closed, consistently-wound mesh this converges to the mesh's true
 * enclosed volume, in whatever units the STL was authored in (assumed mm).
 */
function computeVolumeMm3(positions: Float32Array, index: Uint32Array | null): number {
  let volume = 0;
  const triangleCount = index ? index.length / 3 : positions.length / 9;

  for (let i = 0; i < triangleCount; i++) {
    const ia = index ? index[i * 3] : i * 3;
    const ib = index ? index[i * 3 + 1] : i * 3 + 1;
    const ic = index ? index[i * 3 + 2] : i * 3 + 2;

    const aOffset = ia * 3;
    const bOffset = ib * 3;
    const cOffset = ic * 3;

    volume += signedTetrahedronVolume(
      positions[aOffset], positions[aOffset + 1], positions[aOffset + 2],
      positions[bOffset], positions[bOffset + 1], positions[bOffset + 2],
      positions[cOffset], positions[cOffset + 1], positions[cOffset + 2],
    );
  }

  return Math.abs(volume);
}

addEventListener('message', ({ data }: MessageEvent<StlVolumeRequest>) => {
  const { id, positions, index } = data;

  // A malformed/corrupted STL (e.g. truncated buffers, out-of-range indices, degenerate
  // triangles) must never crash this worker or leave the request hanging forever — that
  // would silently freeze the "Loading STL..." UI on the main thread. Report it as a
  // normal message instead, so `VolumeWorkerService` can reject the matching promise.
  try {
    const volumeMm3 = computeVolumeMm3(positions, index);
    if (!Number.isFinite(volumeMm3)) throw new Error('Non-finite volume');

    const volumeCm3 = volumeMm3 / 1000; // 1 cm^3 = 1000 mm^3
    const response: StlVolumeResponse = { id, volumeCm3 };
    postMessage(response);
  } catch {
    const response: StlVolumeResponse = { id, error: 'Malformed STL file' };
    postMessage(response);
  }
});
