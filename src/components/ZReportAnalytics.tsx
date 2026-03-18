/**
 * RPYM - Analytics de Reportes Z
 * Gráficos históricos con foco en ventas en divisas
 */
import { useState, useMemo } from 'react';
import { formatUSD, formatBs } from '../lib/format';
import type { FiscalReporteZ } from '../lib/fiscal-types';
import {
  LineChart, Line, BarChart, Bar, ComposedChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine
} from 'recharts';

interface Props {
  reportes: FiscalReporteZ[];
  onClose: () => void;
}

type Periodo = '30d' | '90d' | '6m' | '1y' | 'all';
type Vista = 'tendencia' | 'semanal' | 'comparativo';

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export default function ZReportAnalytics({ reportes, onClose }: Props) {
  const [periodo, setPeriodo] = useState<Periodo>('90d');
  const [vista, setVista] = useState<Vista>('tendencia');

  // Filter by period
  const filtered = useMemo(() => {
    const sorted = [...reportes].sort((a, b) => a.fecha.localeCompare(b.fecha));
    if (periodo === 'all') return sorted;

    const now = new Date();
    let cutoff: Date;
    switch (periodo) {
      case '30d': cutoff = new Date(now.getTime() - 30 * 86400000); break;
      case '90d': cutoff = new Date(now.getTime() - 90 * 86400000); break;
      case '6m': cutoff = new Date(now.getTime() - 180 * 86400000); break;
      case '1y': cutoff = new Date(now.getTime() - 365 * 86400000); break;
      default: cutoff = new Date(0);
    }
    const cutoffStr = cutoff.toISOString().split('T')[0];
    return sorted.filter(r => r.fecha >= cutoffStr);
  }, [reportes, periodo]);

  // ── Data for trend chart ──────────────────────────
  const trendData = useMemo(() => {
    return filtered.map(r => {
      const tasa = r.bcvRate || 1;
      const divisasUsd = r.baseImponibleIgtf ? r.baseImponibleIgtf / tasa : 0;
      return {
        fecha: r.fecha.slice(5), // MM-DD
        fechaFull: r.fecha,
        totalUsd: r.totalVentasUsd ? Math.round(r.totalVentasUsd * 100) / 100 : 0,
        divisas: Math.round(divisasUsd * 100) / 100,
        totalBs: r.totalVentas,
        tasa,
        igtf: r.igtfVentas || 0,
        dia: r.diaSemana || '',
      };
    });
  }, [filtered]);

  // ── Moving average (7 days) ────────────────────────
  const trendWithMA = useMemo(() => {
    return trendData.map((d, i) => {
      const window = trendData.slice(Math.max(0, i - 6), i + 1);
      const avgUsd = window.reduce((s, w) => s + w.totalUsd, 0) / window.length;
      const avgDivisas = window.reduce((s, w) => s + w.divisas, 0) / window.length;
      return {
        ...d,
        promedioUsd: Math.round(avgUsd * 100) / 100,
        promedioDivisas: Math.round(avgDivisas * 100) / 100,
      };
    });
  }, [trendData]);

  // ── Weekly pattern data ──────────────────────────
  const weeklyData = useMemo(() => {
    const byDay: Record<number, { totalUsd: number[]; divisas: number[] }> = {};
    for (let i = 0; i < 7; i++) byDay[i] = { totalUsd: [], divisas: [] };

    filtered.forEach(r => {
      const dow = new Date(r.fecha + 'T12:00:00').getDay();
      const tasa = r.bcvRate || 1;
      byDay[dow].totalUsd.push(r.totalVentasUsd || 0);
      byDay[dow].divisas.push(r.baseImponibleIgtf ? r.baseImponibleIgtf / tasa : 0);
    });

    return [1, 2, 3, 4, 5, 6, 0].map(dow => { // Lun-Dom
      const usdArr = byDay[dow].totalUsd;
      const divArr = byDay[dow].divisas;
      return {
        dia: DIAS[dow],
        promedioUsd: usdArr.length ? Math.round(usdArr.reduce((a, b) => a + b, 0) / usdArr.length * 100) / 100 : 0,
        promedioDivisas: divArr.length ? Math.round(divArr.reduce((a, b) => a + b, 0) / divArr.length * 100) / 100 : 0,
        maxUsd: usdArr.length ? Math.round(Math.max(...usdArr) * 100) / 100 : 0,
        minUsd: usdArr.length ? Math.round(Math.min(...usdArr) * 100) / 100 : 0,
        registros: usdArr.length,
      };
    });
  }, [filtered]);

  // ── Monthly comparison ──────────────────────────
  const monthlyData = useMemo(() => {
    const byMonth: Record<string, { totalUsd: number; divisas: number; dias: number; totalBs: number }> = {};

    filtered.forEach(r => {
      const mes = r.fecha.slice(0, 7);
      const tasa = r.bcvRate || 1;
      if (!byMonth[mes]) byMonth[mes] = { totalUsd: 0, divisas: 0, dias: 0, totalBs: 0 };
      byMonth[mes].totalUsd += r.totalVentasUsd || 0;
      byMonth[mes].divisas += r.baseImponibleIgtf ? r.baseImponibleIgtf / tasa : 0;
      byMonth[mes].totalBs += r.totalVentas;
      byMonth[mes].dias++;
    });

    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, d]) => ({
        mes: mes.slice(2), // YY-MM
        mesFull: mes,
        totalUsd: Math.round(d.totalUsd * 100) / 100,
        divisas: Math.round(d.divisas * 100) / 100,
        totalBs: Math.round(d.totalBs * 100) / 100,
        promedioDiario: Math.round((d.totalUsd / d.dias) * 100) / 100,
        promedioDivisas: Math.round((d.divisas / d.dias) * 100) / 100,
        dias: d.dias,
      }));
  }, [filtered]);

  // ── Summary stats ──────────────────────────────
  const stats = useMemo(() => {
    if (filtered.length === 0) return null;
    const totalUsd = filtered.reduce((s, r) => s + (r.totalVentasUsd || 0), 0);
    const totalDivisas = filtered.reduce((s, r) => {
      const tasa = r.bcvRate || 1;
      return s + (r.baseImponibleIgtf ? r.baseImponibleIgtf / tasa : 0);
    }, 0);
    const totalBs = filtered.reduce((s, r) => s + r.totalVentas, 0);
    const avgUsd = totalUsd / filtered.length;
    const avgDivisas = totalDivisas / filtered.length;

    // Best and worst days
    const sorted = [...filtered].sort((a, b) => (b.totalVentasUsd || 0) - (a.totalVentasUsd || 0));
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];

    // Divisa percentage
    const divisaPct = totalUsd > 0 ? (totalDivisas / totalUsd) * 100 : 0;

    return {
      totalUsd, totalDivisas, totalBs, avgUsd, avgDivisas,
      best, worst, divisaPct, dias: filtered.length,
    };
  }, [filtered]);

  const formatTick = (v: number) => `$${Math.round(v)}`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto">
      <div className="bg-white rounded-xl w-full max-w-5xl my-4 mx-4 shadow-xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-ocean-100 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-ocean-900">Analytics - Reportes Z</h2>
          <button onClick={onClose} className="text-ocean-400 hover:text-ocean-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Controls */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex bg-ocean-100 rounded-lg p-0.5 text-xs">
              {([['30d', '30 días'], ['90d', '90 días'], ['6m', '6 meses'], ['1y', '1 año'], ['all', 'Todo']] as [Periodo, string][]).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setPeriodo(val)}
                  className={`px-3 py-1.5 rounded-md transition-colors ${periodo === val ? 'bg-white text-ocean-900 shadow-sm font-medium' : 'text-ocean-600'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex bg-ocean-100 rounded-lg p-0.5 text-xs">
              {([['tendencia', 'Tendencia'], ['semanal', 'Por día'], ['comparativo', 'Mensual']] as [Vista, string][]).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setVista(val)}
                  className={`px-3 py-1.5 rounded-md transition-colors ${vista === val ? 'bg-white text-ocean-900 shadow-sm font-medium' : 'text-ocean-600'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-xs text-ocean-400 ml-auto">{filtered.length} reportes</span>
          </div>

          {/* Stats cards */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-ocean-50 rounded-lg p-3">
                <div className="text-xs text-ocean-500">Promedio diario</div>
                <div className="text-lg font-bold text-ocean-900">{formatUSD(stats.avgUsd)}</div>
              </div>
              <div className="bg-emerald-50 rounded-lg p-3">
                <div className="text-xs text-emerald-600">Promedio divisas/día</div>
                <div className="text-lg font-bold text-emerald-700">{formatUSD(stats.avgDivisas)}</div>
              </div>
              <div className="bg-amber-50 rounded-lg p-3">
                <div className="text-xs text-amber-600">% en divisas</div>
                <div className="text-lg font-bold text-amber-700">{stats.divisaPct.toFixed(1)}%</div>
              </div>
              <div className="bg-ocean-50 rounded-lg p-3">
                <div className="text-xs text-ocean-500">Total período</div>
                <div className="text-lg font-bold text-ocean-900">{formatUSD(stats.totalUsd)}</div>
                <div className="text-xs text-emerald-600">{formatUSD(stats.totalDivisas)} divisas</div>
              </div>
            </div>
          )}

          {/* Charts */}
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-ocean-400">No hay datos para el período seleccionado</div>
          ) : vista === 'tendencia' ? (
            <div className="space-y-6">
              {/* Total USD + Divisas trend */}
              <div className="bg-white border border-ocean-100 rounded-xl p-4">
                <h3 className="text-sm font-medium text-ocean-700 mb-3">Ventas diarias USD (total vs divisas)</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={trendWithMA}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e7ef" />
                    <XAxis dataKey="fecha" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tickFormatter={formatTick} tick={{ fontSize: 10 }} />
                    <Tooltip
                      formatter={(value: number, name: string) => [formatUSD(value), name]}
                      labelFormatter={(label: string, payload: any[]) => {
                        const d = payload?.[0]?.payload;
                        return d ? `${d.fechaFull} (${d.dia})` : label;
                      }}
                    />
                    <Legend />
                    <Area type="monotone" dataKey="totalUsd" name="Total USD" fill="#dbeafe" stroke="#3b82f6" fillOpacity={0.3} />
                    <Area type="monotone" dataKey="divisas" name="Divisas" fill="#d1fae5" stroke="#10b981" fillOpacity={0.4} />
                    <Line type="monotone" dataKey="promedioUsd" name="Promedio 7d" stroke="#1e40af" strokeWidth={2} dot={false} strokeDasharray="5 5" />
                    <Line type="monotone" dataKey="promedioDivisas" name="Prom. divisas 7d" stroke="#065f46" strokeWidth={2} dot={false} strokeDasharray="5 5" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* BCV Rate trend */}
              <div className="bg-white border border-ocean-100 rounded-xl p-4">
                <h3 className="text-sm font-medium text-ocean-700 mb-3">Tasa BCV</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={trendWithMA}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e7ef" />
                    <XAxis dataKey="fecha" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                    <Tooltip
                      formatter={(value: number) => [value.toFixed(2), 'Tasa BCV']}
                      labelFormatter={(label: string, payload: any[]) => payload?.[0]?.payload?.fechaFull || label}
                    />
                    <Line type="monotone" dataKey="tasa" name="Tasa BCV" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : vista === 'semanal' ? (
            <div className="bg-white border border-ocean-100 rounded-xl p-4">
              <h3 className="text-sm font-medium text-ocean-700 mb-3">Promedio por día de la semana</h3>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={weeklyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0e7ef" />
                  <XAxis dataKey="dia" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={formatTick} tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(value: number, name: string) => [formatUSD(value), name]}
                  />
                  <Legend />
                  <Bar dataKey="promedioUsd" name="Prom. Total USD" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="promedioDivisas" name="Prom. Divisas" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              {/* Min/max table */}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-ocean-500">
                    <tr>
                      <th className="text-left py-1">Día</th>
                      <th className="text-right py-1">Min USD</th>
                      <th className="text-right py-1">Prom USD</th>
                      <th className="text-right py-1">Max USD</th>
                      <th className="text-right py-1">Prom Divisas</th>
                      <th className="text-center py-1">Registros</th>
                    </tr>
                  </thead>
                  <tbody className="text-ocean-700">
                    {weeklyData.map(d => (
                      <tr key={d.dia} className="border-t border-ocean-50">
                        <td className="py-1 font-medium">{d.dia}</td>
                        <td className="text-right py-1">{formatUSD(d.minUsd)}</td>
                        <td className="text-right py-1 font-medium">{formatUSD(d.promedioUsd)}</td>
                        <td className="text-right py-1">{formatUSD(d.maxUsd)}</td>
                        <td className="text-right py-1 text-emerald-600">{formatUSD(d.promedioDivisas)}</td>
                        <td className="text-center py-1 text-ocean-400">{d.registros}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Monthly comparison */}
              <div className="bg-white border border-ocean-100 rounded-xl p-4">
                <h3 className="text-sm font-medium text-ocean-700 mb-3">Comparativo mensual</h3>
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e7ef" />
                    <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={formatTick} tick={{ fontSize: 10 }} />
                    <Tooltip
                      formatter={(value: number, name: string) => [formatUSD(value), name]}
                      labelFormatter={(label: string, payload: any[]) => payload?.[0]?.payload?.mesFull || label}
                    />
                    <Legend />
                    <Bar dataKey="totalUsd" name="Total USD" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="divisas" name="Divisas" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Daily average per month */}
              <div className="bg-white border border-ocean-100 rounded-xl p-4">
                <h3 className="text-sm font-medium text-ocean-700 mb-3">Promedio diario por mes</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e7ef" />
                    <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={formatTick} tick={{ fontSize: 10 }} />
                    <Tooltip
                      formatter={(value: number, name: string) => [formatUSD(value), name]}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="promedioDiario" name="Prom. diario USD" stroke="#3b82f6" strokeWidth={2} />
                    <Line type="monotone" dataKey="promedioDivisas" name="Prom. diario divisas" stroke="#10b981" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Monthly summary table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-ocean-500 bg-ocean-50">
                    <tr>
                      <th className="text-left px-3 py-2">Mes</th>
                      <th className="text-right px-3 py-2">Total USD</th>
                      <th className="text-right px-3 py-2">Divisas</th>
                      <th className="text-right px-3 py-2">% Divisas</th>
                      <th className="text-right px-3 py-2">Prom/día</th>
                      <th className="text-center px-3 py-2">Días</th>
                    </tr>
                  </thead>
                  <tbody className="text-ocean-700">
                    {monthlyData.map(d => (
                      <tr key={d.mesFull} className="border-t border-ocean-50">
                        <td className="px-3 py-2 font-medium">{d.mesFull}</td>
                        <td className="text-right px-3 py-2">{formatUSD(d.totalUsd)}</td>
                        <td className="text-right px-3 py-2 text-emerald-600">{formatUSD(d.divisas)}</td>
                        <td className="text-right px-3 py-2">{d.totalUsd > 0 ? ((d.divisas / d.totalUsd) * 100).toFixed(1) : 0}%</td>
                        <td className="text-right px-3 py-2">{formatUSD(d.promedioDiario)}</td>
                        <td className="text-center px-3 py-2 text-ocean-400">{d.dias}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
