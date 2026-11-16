import { Injectable, signal } from '@angular/core';
import { CompanyProfile, DEFAULT_COMPANY_PROFILE } from '../models/company-profile.model';

const STORAGE_KEY = 'print-ops.company-profile.v1';

/** Persists the B2B company profile (name + logo) across sessions via LocalStorage. */
@Injectable({ providedIn: 'root' })
export class CompanyProfileStorageService {
  /** Exposed as a signal so the quote header stays in sync with the form without re-reading LocalStorage. */
  readonly profile = signal<CompanyProfile>(this.load());

  save(profile: CompanyProfile): void {
    this.profile.set(profile);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch {
      // best-effort; LocalStorage may be unavailable (private mode, quota, etc.)
    }
  }

  private load(): CompanyProfile {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...DEFAULT_COMPANY_PROFILE, ...(JSON.parse(raw) as CompanyProfile) } : DEFAULT_COMPANY_PROFILE;
    } catch {
      return DEFAULT_COMPANY_PROFILE;
    }
  }
}
