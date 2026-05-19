/**
 * Template visual para exportar el estado de cuenta como PNG o PDF.
 * Usa inline styles para garantizar renderizado correcto con html2canvas.
 * Ancho fijo 640px optimizado para compartir por WhatsApp.
 */
import { formatUSD, formatEUR } from '../lib/format';

interface PublicTransaction {
  id: number;
  type: 'purchase' | 'payment';
  date: string;
  description: string;
  amountUsd: number;
  amountBs: number;
  presupuestoId: string | null;
  invoiceImageUrl: string | null;
  currencyType: string;
  paymentMethod: string | null;
  exchangeRate: number | null;
  amountUsdDivisa: number | null;
  isPaid: boolean;
  isCrossed: boolean;
  paidMethod: string | null;
  paidDate: string | null;
  notes: string | null;
  createdAt: string;
}

interface PublicCustomer {
  name: string;
  rateType: string;
  balanceDivisas: number;
  balanceBcv: number;
  balanceEuro: number;
}

interface Props {
  customer: PublicCustomer;
  transactions: PublicTransaction[];
  bcvRate: number;
  dualView: 'bcv' | 'divisas';
  adjustedBalances: { divisas: number; bcv: number; euro: number };
  generatedAt: string;
}

const C = {
  primaryDark: '#0c4a6e',
  primary: '#0369a1',
  primaryMid: '#0284c7',
  primaryLight: '#e0f2fe',
  primaryBg: '#f0f9ff',
  red: '#dc2626',
  redLight: '#fef2f2',
  green: '#16a34a',
  greenLight: '#f0fdf4',
  gray: '#64748b',
  grayLight: '#f8fafc',
  border: '#e2e8f0',
  text: '#1e293b',
  textMuted: '#94a3b8',
};

function formatTxDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: '2-digit' });
}

function formatPaymentMethod(method: string | null) {
  if (!method) return '';
  const map: Record<string, string> = {
    efectivo: 'Efectivo',
    pago_movil: 'P. Móvil',
    transferencia: 'Transf.',
    zelle: 'Zelle',
    usdt: 'USDT',
    tarjeta: 'Tarjeta',
  };
  return map[method] || method;
}

export default function EstadoCuentaExport({ customer, transactions, bcvRate, dualView, adjustedBalances, generatedAt }: Props) {
  const totalBalance = adjustedBalances.divisas + adjustedBalances.bcv + adjustedBalances.euro;
  const isPositive = totalBalance > 0;
  const isZero = totalBalance === 0;

  const getDisplayAmount = (tx: PublicTransaction) => {
    if (dualView === 'divisas' && tx.amountUsdDivisa != null && tx.amountUsdDivisa > 0) {
      return tx.amountUsdDivisa;
    }
    return tx.amountUsd;
  };

  const showBcv = adjustedBalances.bcv !== 0;
  const showDivisas = adjustedBalances.divisas !== 0;
  const showEuro = adjustedBalances.euro !== 0;
  const balanceCols = [showBcv, showDivisas, showEuro].filter(Boolean).length;

  return (
    <div
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        width: '640px',
        backgroundColor: '#ffffff',
        color: C.text,
        fontSize: '13px',
        lineHeight: '1.5',
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          background: `linear-gradient(135deg, ${C.primaryDark} 0%, ${C.primaryMid} 100%)`,
          color: '#fff',
          padding: '24px 28px 20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
          <div
            style={{
              width: '46px',
              height: '46px',
              background: 'rgba(255,255,255,0.18)',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px',
              flexShrink: 0,
            }}
          >
            🐟
          </div>
          <div>
            <div style={{ fontSize: '20px', fontWeight: '800', letterSpacing: '-0.02em' }}>RPYM Mariscos</div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.65)', marginTop: '2px' }}>El Rey de los Pescados y Mariscos</div>
          </div>
        </div>

        <div
          style={{
            background: 'rgba(255,255,255,0.14)',
            borderRadius: '12px',
            padding: '12px 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
              Estado de Cuenta
            </div>
            <div style={{ fontSize: '17px', fontWeight: '700' }}>{customer.name}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Generado</div>
            <div style={{ fontSize: '11px', fontWeight: '600', marginTop: '3px' }}>{generatedAt}</div>
          </div>
        </div>
      </div>

      {/* ── Balance ── */}
      <div
        style={{
          padding: '20px 28px',
          background: isZero ? C.greenLight : isPositive ? C.redLight : C.greenLight,
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div style={{ fontSize: '10px', color: C.gray, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: '600', marginBottom: '6px' }}>
          Balance Pendiente
        </div>
        <div
          style={{
            fontSize: '36px',
            fontWeight: '800',
            color: isZero ? C.green : isPositive ? C.red : C.green,
            letterSpacing: '-0.03em',
            lineHeight: '1',
          }}
        >
          {formatUSD(Math.abs(totalBalance))}
        </div>
        <div style={{ fontSize: '12px', color: isZero ? C.green : isPositive ? C.red : C.green, marginTop: '5px', fontWeight: '500' }}>
          {isZero ? '✓ Al día' : isPositive ? 'Por pagar' : 'A favor'}
        </div>

        {/* Breakdown */}
        {balanceCols > 0 && !isZero && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
            {showBcv && (
              <div
                style={{
                  flex: 1,
                  background: '#fff',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  border: `1px solid ${C.border}`,
                }}
              >
                <div style={{ fontSize: '9px', color: C.gray, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '4px' }}>BCV</div>
                <div style={{ fontSize: '15px', fontWeight: '700', color: adjustedBalances.bcv > 0 ? C.red : C.green }}>
                  {formatUSD(Math.abs(adjustedBalances.bcv))}
                </div>
                {bcvRate > 0 && adjustedBalances.bcv !== 0 && (
                  <div style={{ fontSize: '10px', color: C.gray, marginTop: '3px' }}>
                    Bs {(Math.abs(adjustedBalances.bcv) * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                )}
                <div style={{ fontSize: '9px', color: C.textMuted, marginTop: '3px' }}>Pago en Bs</div>
              </div>
            )}
            {showDivisas && (
              <div
                style={{
                  flex: 1,
                  background: '#fff',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  border: `1px solid ${C.border}`,
                }}
              >
                <div style={{ fontSize: '9px', color: C.gray, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '4px' }}>Divisas</div>
                <div style={{ fontSize: '15px', fontWeight: '700', color: adjustedBalances.divisas > 0 ? C.red : C.green }}>
                  {formatUSD(Math.abs(adjustedBalances.divisas))}
                </div>
                <div style={{ fontSize: '9px', color: C.textMuted, marginTop: '3px' }}>USD efectivo</div>
              </div>
            )}
            {showEuro && (
              <div
                style={{
                  flex: 1,
                  background: '#fff',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  border: `1px solid ${C.border}`,
                }}
              >
                <div style={{ fontSize: '9px', color: C.gray, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '4px' }}>€ Euro</div>
                <div style={{ fontSize: '15px', fontWeight: '700', color: adjustedBalances.euro > 0 ? C.red : C.green }}>
                  {formatEUR(Math.abs(adjustedBalances.euro))}
                </div>
                <div style={{ fontSize: '9px', color: C.textMuted, marginTop: '3px' }}>Pago en EUR</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Transactions header ── */}
      <div
        style={{
          padding: '12px 28px 10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: C.grayLight,
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <span
          style={{
            fontSize: '10px',
            fontWeight: '700',
            color: C.primaryDark,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Movimientos
        </span>
        <span style={{ fontSize: '10px', color: C.gray }}>{transactions.length} registro{transactions.length !== 1 ? 's' : ''}</span>
      </div>

      {/* ── Transaction rows ── */}
      {transactions.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: C.gray, fontSize: '12px' }}>
          No hay movimientos registrados
        </div>
      ) : (
        <div>
          {transactions.map((tx, i) => {
            const displayAmt = getDisplayAmount(tx);
            const isDual = tx.amountUsdDivisa != null && tx.amountUsdDivisa > 0;
            const dimmed = tx.isPaid || tx.isCrossed;
            const isPurchase = tx.type === 'purchase';

            return (
              <div
                key={tx.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  padding: '10px 28px',
                  borderBottom: `1px solid ${C.border}`,
                  background: i % 2 === 0 ? '#ffffff' : C.grayLight,
                  opacity: dimmed ? 0.55 : 1,
                }}
              >
                {/* Color dot */}
                <div
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    marginTop: '5px',
                    marginRight: '12px',
                    flexShrink: 0,
                    background: dimmed ? C.textMuted : isPurchase ? C.red : C.green,
                  }}
                />

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: '600',
                      color: dimmed ? C.textMuted : C.text,
                      textDecoration: tx.isCrossed ? 'line-through' : 'none',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '310px',
                    }}
                  >
                    {tx.description}
                  </div>
                  <div style={{ display: 'flex', gap: '5px', alignItems: 'center', marginTop: '4px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '10px', color: C.textMuted }}>{formatTxDate(tx.date)}</span>

                    {tx.isPaid && (
                      <span style={{ fontSize: '9px', padding: '1px 6px', background: '#dcfce7', color: '#166534', borderRadius: '4px', fontWeight: '600' }}>
                        Pagado{tx.paidMethod ? ` · ${formatPaymentMethod(tx.paidMethod)}` : ''}
                      </span>
                    )}
                    {isDual && (
                      <span style={{ fontSize: '9px', padding: '1px 6px', background: '#f3e8ff', color: '#6b21a8', borderRadius: '4px', fontWeight: '600' }}>
                        Dual
                      </span>
                    )}
                    {!isDual && !tx.isPaid && tx.currencyType === 'divisas' && (
                      <span style={{ fontSize: '9px', padding: '1px 6px', background: '#dcfce7', color: '#166534', borderRadius: '4px', fontWeight: '600' }}>USD</span>
                    )}
                    {!isDual && !tx.isPaid && tx.currencyType === 'dolar_bcv' && (
                      <span style={{ fontSize: '9px', padding: '1px 6px', background: '#dbeafe', color: '#1e40af', borderRadius: '4px', fontWeight: '600' }}>BCV</span>
                    )}
                    {!isDual && !tx.isPaid && tx.currencyType === 'euro_bcv' && (
                      <span style={{ fontSize: '9px', padding: '1px 6px', background: '#ede9fe', color: '#5b21b6', borderRadius: '4px', fontWeight: '600' }}>EUR</span>
                    )}
                    {tx.paymentMethod && tx.type === 'payment' && (
                      <span style={{ fontSize: '9px', padding: '1px 6px', background: '#f1f5f9', color: C.gray, borderRadius: '4px' }}>
                        {formatPaymentMethod(tx.paymentMethod)}
                      </span>
                    )}
                  </div>
                  {tx.notes && (
                    <div style={{ fontSize: '10px', color: C.gray, fontStyle: 'italic', marginTop: '3px' }}>
                      {tx.notes}
                    </div>
                  )}
                </div>

                {/* Amount */}
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '12px' }}>
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: '700',
                      color: dimmed ? C.textMuted : isPurchase ? C.red : C.green,
                      textDecoration: tx.isCrossed ? 'line-through' : 'none',
                    }}
                  >
                    {isPurchase ? '+' : '−'}{formatUSD(displayAmt)}
                  </div>
                  {bcvRate > 0 && !tx.isPaid && tx.currencyType !== 'divisas' && dualView !== 'divisas' && !tx.isCrossed && (
                    <div style={{ fontSize: '10px', color: C.textMuted, marginTop: '2px' }}>
                      Bs {(displayAmt * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Footer ── */}
      <div
        style={{
          background: C.primaryLight,
          borderTop: `2px solid ${C.primary}`,
          padding: '16px 28px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <div style={{ fontSize: '13px', fontWeight: '800', color: C.primaryDark }}>RPYM Mariscos</div>
          <div style={{ fontSize: '10px', color: C.gray, marginTop: '3px' }}>Muelle El Mosquero, Maiquetía</div>
          <div style={{ fontSize: '10px', color: C.green, marginTop: '2px', fontWeight: '600' }}>+58 414-214-5202</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '9px', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Documento generado</div>
          <div style={{ fontSize: '11px', fontWeight: '600', color: C.primaryDark, marginTop: '3px' }}>{generatedAt}</div>
          <div style={{ fontSize: '9px', color: C.textMuted, marginTop: '2px' }}>rpym.net</div>
        </div>
      </div>
    </div>
  );
}
