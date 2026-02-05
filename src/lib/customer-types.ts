/**
 * RPYM - TypeScript types for customer accounts/ledger
 */

// D1 row types (snake_case as stored in database)
export interface D1Customer {
  id: number;
  name: string;
  phone: string | null;
  notes: string | null;
  rate_type: 'dolar_bcv' | 'euro_bcv' | 'manual';
  custom_rate: number | null;
  share_token: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface D1CustomerWithBalance extends D1Customer {
  balance_divisas: number;
  balance_bcv: number;
  balance_euro: number;
}

export interface D1CustomerTransaction {
  id: number;
  customer_id: number;
  type: 'purchase' | 'payment';
  date: string;
  description: string;
  amount_usd: number;
  amount_bs: number;
  amount_usd_divisa: number | null;
  presupuesto_id: string | null;
  invoice_image_key: string | null;
  currency_type: 'divisas' | 'dolar_bcv' | 'euro_bcv';
  payment_method: string | null;
  exchange_rate: number | null;
  notes: string | null;
  is_paid: number;
  paid_method: string | null;
  paid_date: string | null;
  created_at: string;
  updated_at: string;
}

// API response types (camelCase)
export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  notes: string | null;
  rateType: 'dolar_bcv' | 'euro_bcv' | 'manual';
  customRate: number | null;
  shareToken: string | null;
  isActive: boolean;
  balanceDivisas: number;
  balanceBcv: number;
  balanceEuro: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerTransaction {
  id: number;
  customerId: number;
  type: 'purchase' | 'payment';
  date: string;
  description: string;
  amountUsd: number;
  amountBs: number;
  amountUsdDivisa: number | null;
  presupuestoId: string | null;
  invoiceImageUrl: string | null;
  currencyType: 'divisas' | 'dolar_bcv' | 'euro_bcv';
  paymentMethod: string | null;
  exchangeRate: number | null;
  notes: string | null;
  isPaid: boolean;
  paidMethod: string | null;
  paidDate: string | null;
  createdAt: string;
  updatedAt: string;
}

// Transform D1 row to API response
export function transformCustomer(row: D1CustomerWithBalance): Customer {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    notes: row.notes,
    rateType: row.rate_type,
    customRate: row.custom_rate,
    shareToken: row.share_token,
    isActive: row.is_active === 1,
    balanceDivisas: row.balance_divisas || 0,
    balanceBcv: row.balance_bcv || 0,
    balanceEuro: row.balance_euro || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function transformTransaction(row: D1CustomerTransaction): CustomerTransaction {
  return {
    id: row.id,
    customerId: row.customer_id,
    type: row.type,
    date: row.date,
    description: row.description,
    amountUsd: row.amount_usd,
    amountBs: row.amount_bs,
    amountUsdDivisa: row.amount_usd_divisa,
    presupuestoId: row.presupuesto_id,
    invoiceImageUrl: row.invoice_image_key ? `/api/customers/invoice/${row.invoice_image_key}` : null,
    currencyType: row.currency_type || 'divisas',
    paymentMethod: row.payment_method,
    exchangeRate: row.exchange_rate,
    notes: row.notes,
    isPaid: row.is_paid === 1,
    paidMethod: row.paid_method,
    paidDate: row.paid_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
