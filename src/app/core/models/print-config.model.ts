export type Currency = 'USD' | 'EUR' | 'GBP' | 'ARS' | 'BRL' | 'MXN';

/** Display symbol used alongside `CurrencyPipe`, which only ships locale data for a subset of codes. */
export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  ARS: 'AR$',
  BRL: 'R$',
  MXN: 'Mex$',
};

/** A reusable filament profile: either a built-in default or a user-saved custom entry. */
export interface MaterialProfile {
  id: string;
  name: string;
  densityGCm3: number;
  costPerKg: number;
  currency: Currency;
}

export const DEFAULT_MATERIAL_PROFILES: MaterialProfile[] = [
  { id: 'PLA', name: 'PLA', densityGCm3: 1.24, costPerKg: 20, currency: 'USD' },
  { id: 'PETG', name: 'PETG', densityGCm3: 1.27, costPerKg: 22, currency: 'USD' },
  { id: 'ABS', name: 'ABS', densityGCm3: 1.04, costPerKg: 20, currency: 'USD' },
  { id: 'ASA', name: 'ASA', densityGCm3: 1.07, costPerKg: 25, currency: 'USD' },
  { id: 'TPU', name: 'TPU (Flex)', densityGCm3: 1.22, costPerKg: 35, currency: 'USD' },
  { id: 'NYLON', name: 'Nylon (PA)', densityGCm3: 1.14, costPerKg: 45, currency: 'USD' },
  { id: 'PC', name: 'Polycarbonate (PC)', densityGCm3: 1.2, costPerKg: 40, currency: 'USD' },
  { id: 'HIPS', name: 'HIPS', densityGCm3: 1.04, costPerKg: 22, currency: 'USD' },
  { id: 'PLA_CF', name: 'PLA-CF (Carbon Fiber)', densityGCm3: 1.3, costPerKg: 50, currency: 'USD' },
];

/** A printer's usable build volume (mm). `sizeMm.y` is the Z-height limit (three.js is Y-up). */
export interface PrinterProfile {
  id: string;
  name: string;
  sizeMm: { x: number; y: number; z: number };
}

export const PRINTER_PROFILES: PrinterProfile[] = [
  { id: 'MINI', name: 'Mini (180×180×180)', sizeMm: { x: 180, y: 180, z: 180 } },
  { id: 'STANDARD', name: 'Standard (220×220×250)', sizeMm: { x: 220, y: 250, z: 220 } },
  { id: 'MEDIUM', name: 'Medium (256×256×256)', sizeMm: { x: 256, y: 256, z: 256 } },
  { id: 'LARGE', name: 'Large (300×300×300)', sizeMm: { x: 300, y: 300, z: 300 } },
  { id: 'MAX', name: 'Max (400×400×400)', sizeMm: { x: 400, y: 400, z: 400 } },
];

export interface PrintConfig {
  materialProfileId: string;
  densityGCm3: number;
  costPerKg: number;
  currency: Currency;
  infillPercent: number;
  printerProfileId: string;
}

export const DEFAULT_PRINT_CONFIG: PrintConfig = {
  materialProfileId: 'PLA',
  densityGCm3: DEFAULT_MATERIAL_PROFILES[0].densityGCm3,
  costPerKg: DEFAULT_MATERIAL_PROFILES[0].costPerKg,
  currency: DEFAULT_MATERIAL_PROFILES[0].currency,
  infillPercent: 20,
  printerProfileId: 'STANDARD',
};
