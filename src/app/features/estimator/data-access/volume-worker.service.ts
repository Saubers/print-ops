import { Injectable, OnDestroy } from '@angular/core';
import { BufferGeometry } from 'three';
import type { StlVolumeRequest, StlVolumeResponse } from '../workers/stl-volume.worker';

/**
 * Thin client around the STL volume Web Worker. Keeps a single worker alive
 * for the lifetime of the app and matches responses by request id so a
 * stale calculation from a previously loaded file can never resolve late
 * and clobber a newer one.
 */
@Injectable({ providedIn: 'root' })
export class VolumeWorkerService implements OnDestroy {
  private readonly worker: Worker | null = typeof Worker !== 'undefined'
    ? new Worker(new URL('../workers/stl-volume.worker', import.meta.url))
    : null;

  private readonly pending = new Map<number, { resolve: (volumeCm3: number) => void; reject: (error: Error) => void }>();
  private nextId = 0;

  constructor() {
    if (this.worker) {
      this.worker.onmessage = ({ data }: MessageEvent<StlVolumeResponse>) => {
        const entry = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (!entry) return;

        if (data.error) entry.reject(new Error(data.error));
        else entry.resolve(data.volumeCm3!);
      };

      // A worker-level crash (an exception escaping the worker's own try/catch, or the
      // worker process dying outright) fires `onerror` instead of `onmessage` — without
      // this, every pending promise would hang forever and silently freeze the UI.
      this.worker.onerror = () => {
        for (const { reject } of this.pending.values()) reject(new Error('Malformed STL file'));
        this.pending.clear();
      };
    }
  }

  calculateVolumeCm3(geometry: BufferGeometry): Promise<number> {
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();

    // Copy into fresh buffers: the originals are owned by the renderer's
    // BufferGeometry, and transferring them to the worker would detach
    // them, corrupting the mesh currently on screen.
    const positions = new Float32Array(position.array as ArrayLike<number>);
    const indexArray = index ? new Uint32Array(index.array as ArrayLike<number>) : null;

    if (!this.worker) {
      try {
        return Promise.resolve(computeVolumeCm3OnMainThread(positions, indexArray));
      } catch {
        return Promise.reject(new Error('Malformed STL file'));
      }
    }

    const id = this.nextId++;
    const request: StlVolumeRequest = { id, positions, index: indexArray };
    const transfer: Transferable[] = [positions.buffer];
    if (indexArray) transfer.push(indexArray.buffer);

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage(request, transfer);
    });
  }

  ngOnDestroy(): void {
    this.worker?.terminate();
  }
}

/** Fallback for environments without Worker support (e.g. some SSR contexts). */
function computeVolumeCm3OnMainThread(positions: Float32Array, index: Uint32Array | null): number {
  let volume = 0;
  const triangleCount = index ? index.length / 3 : positions.length / 9;

  for (let i = 0; i < triangleCount; i++) {
    const ia = index ? index[i * 3] : i * 3;
    const ib = index ? index[i * 3 + 1] : i * 3 + 1;
    const ic = index ? index[i * 3 + 2] : i * 3 + 2;
    const a = ia * 3, b = ib * 3, c = ic * 3;

    volume += (
      positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) -
      positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c]) +
      positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])
    ) / 6;
  }

  const volumeCm3 = Math.abs(volume) / 1000;
  if (!Number.isFinite(volumeCm3)) throw new Error('Non-finite volume');
  return volumeCm3;
}
