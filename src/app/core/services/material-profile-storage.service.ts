import { Injectable } from '@angular/core';
import { MaterialProfile } from '../models/print-config.model';

const STORAGE_KEY = 'print-ops.material-profiles.v1';

/** Persists user-created material profiles. Defaults are never stored here, only merged in by the caller. */
@Injectable({ providedIn: 'root' })
export class MaterialProfileStorageService {
  loadCustom(): MaterialProfile[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as MaterialProfile[]) : [];
    } catch {
      return [];
    }
  }

  saveCustom(profiles: MaterialProfile[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
    } catch {
      // best-effort; LocalStorage may be unavailable (private mode, quota, etc.)
    }
  }
}
