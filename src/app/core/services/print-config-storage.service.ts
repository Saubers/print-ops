import { Injectable } from '@angular/core';
import { PrintConfig } from '../models/print-config.model';

const STORAGE_KEY = 'print-ops.config.v1';

/** Persists the configuration form across sessions via LocalStorage. */
@Injectable({ providedIn: 'root' })
export class PrintConfigStorageService {
  load(): Partial<PrintConfig> | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Partial<PrintConfig>) : null;
    } catch {
      return null;
    }
  }

  save(config: PrintConfig): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      // LocalStorage unavailable (private mode / quota exceeded) - persistence is best-effort.
    }
  }
}
