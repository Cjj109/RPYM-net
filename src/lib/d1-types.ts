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
  total_usd_divisa: number | null;
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

// Cloudflare R2 binding types
export interface R2Bucket {
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null, options?: R2PutOptions): Promise<R2Object>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string | string[]): Promise<void>;
  list(options?: R2ListOptions): Promise<R2Objects>;
}

export interface R2PutOptions {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

export interface R2Object {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
}

export interface R2ObjectBody extends R2Object {
  body: ReadableStream;
  bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
}

export interface R2ListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
}

export interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
}

// Cloudflare runtime environment
export interface CloudflareEnv {
  DB: D1Database;
  R2_BUCKET?: R2Bucket;
  // Meta WhatsApp Cloud API
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
}

// Helper to get D1 from Astro locals
export function getD1(locals: App.Locals): D1Database | null {
  const runtime = (locals as any).runtime;
  return runtime?.env?.DB || null;
}

// Helper to get R2 from Astro locals
export function getR2(locals: App.Locals): R2Bucket | null {
  const runtime = (locals as any).runtime;
  return runtime?.env?.R2_BUCKET || null;
}
