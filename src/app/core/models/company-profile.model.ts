/** B2B branding shown on the generated PDF quote. Persisted client-side only (LocalStorage). */
export interface CompanyProfile {
  name: string;
  /** Base64 data URL (PNG/JPG), produced via FileReader from the uploaded logo file. */
  logoBase64: string | null;
}

export const DEFAULT_COMPANY_PROFILE: CompanyProfile = {
  name: '',
  logoBase64: null,
};
