/**
 * RPYM - TypeScript types for D1 database
 */

// Theme names
export type ThemeName = 'ocean' | 'carnival' | 'christmas' | 'easter';

// D1 row types (snake_case as stored in database)
export interface D1Presupuesto {
  id: string;
  fecha: string;
  items: string; // JSON string
  total_usd: number;
  total_bs: number;
  estado: 'pendiente' | 'pagado';
  customer_name: string | null;
  customer_address: string | null;
  client_ip: string | null;
  source: 'admin' | 'cliente';
  fecha_pago: string | null;
  created_at: string;
  updated_at: string;
}

export interface D1ConfigRow {
  key: string;
  value: string;
  updated_at: string;
}

// Site configuration (parsed from D1)
export interface SiteConfig {
  theme: ThemeName;
  bcvRate: number;
  bcvRateManual: boolean;
  bcvRateUpdatedAt: string;
}

// API response types
export interface ThemeResponse {
  theme: ThemeName;
  updatedAt?: string;
}

export interface BCVRateResponse {
  rate: number;
  manual: boolean;
  updatedAt: string;
}

// Cloudflare D1 binding type
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  dump(): Promise<ArrayBuffer>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(): Promise<T[]>;
}

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: {
    duration: number;
    changes: number;
    last_row_id: number;
    served_by: string;
  };
}

export interface D1ExecResult {
  count: number;
  duration: number;
}

// Cloudflare runtime environment
export interface CloudflareEnv {
  DB: D1Database;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
}

// Helper to get D1 from Astro locals
export function getD1(locals: App.Locals): D1Database | null {
  const runtime = (locals as any).runtime;
  return runtime?.env?.DB || null;
}
