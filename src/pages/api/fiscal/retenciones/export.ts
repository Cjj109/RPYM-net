import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../lib/require-auth';

export const prerender = false;

/**
 * SENIAT TXT Format for "Declaración Informativa de Retenciones de IVA"
 *
 * Columns (separated by tab):
 * 1. RifRetenido - RIF del proveedor (sin guiones)
 * 2. NumeroFactura - Número de factura
 * 3. NumeroControl - Número de control (sin guiones)
 * 4. FechaOperacion - Fecha de la factura (DD/MM/YYYY)
 * 5. MontoFacturado - Monto total facturado (con 2 decimales)
 * 6. BaseImponible - Base imponible (con 2 decimales)
 * 7. MontoIVA - Monto del IVA de la factura (con 2 decimales)
 * 8. MontoRetenido - Monto retenido (con 2 decimales)
 * 9. NumeroComprobante - Número del comprobante de retención
 * 10. TipoOperacion - "C" para compras
 * 11. PorcentajeRetencion - 75 o 100
 */

interface RetencionExportRow {
  proveedor_rif: string;
  proveedor_nombre: string;
  numero_factura: string;
  numero_control: string | null;
  fecha_factura: string;
  subtotal_gravable: number;
  iva: number;
  total: number;
  monto_retenido: number;
  numero_comprobante: string;
  retencion_iva_pct: number;
}

// GET /api/fiscal/retenciones/export?periodo=YYYY-MM&format=txt|csv
export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const url = new URL(request.url);
    const periodo = url.searchParams.get('periodo'); // YYYY-MM
    const format = url.searchParams.get('format') || 'txt';

    if (!periodo) {
      return new Response(JSON.stringify({ success: false, error: 'Período requerido (YYYY-MM)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get retentions with invoice and provider data
    const results = await db.prepare(`
      SELECT
        r.numero_comprobante,
        r.monto_retenido,
        r.fecha_emision,
        p.rif as proveedor_rif,
        p.nombre as proveedor_nombre,
        p.retencion_iva_pct,
        f.numero_factura,
        f.numero_control,
        f.fecha_factura,
        f.subtotal_gravable,
        f.iva,
        f.total
      FROM fiscal_retenciones_iva r
      LEFT JOIN fiscal_facturas_compra f ON r.factura_id = f.id
      LEFT JOIN fiscal_proveedores p ON f.proveedor_id = p.id
      WHERE r.periodo_fiscal = ?
      ORDER BY r.fecha_emision ASC
    `).bind(periodo).all<RetencionExportRow>();

    const rows = results.results || [];

    if (rows.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: `No hay retenciones para el período ${periodo}`
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Calculate totals for summary
    const totals = {
      totalFacturado: 0,
      totalBaseImponible: 0,
      totalIVA: 0,
      totalRetenido: 0,
      cantidadRetenciones: rows.length,
    };

    // Format data for export
    const exportRows: string[] = [];

    // Helper to format RIF (remove dashes and spaces)
    const formatRif = (rif: string | null) => {
      if (!rif) return '';
      return rif.replace(/[-\s]/g, '').toUpperCase();
    };

    // Helper to format date DD/MM/YYYY
    const formatDate = (dateStr: string | null) => {
      if (!dateStr) return '';
      const [year, month, day] = dateStr.split('-');
      return `${day}/${month}/${year}`;
    };

    // Helper to format number with 2 decimals
    const formatNumber = (num: number | null) => {
      if (num === null || num === undefined) return '0.00';
      return num.toFixed(2);
    };

    // Helper to format control number (remove dashes)
    const formatControl = (control: string | null) => {
      if (!control) return '';
      return control.replace(/-/g, '');
    };

    for (const row of rows) {
      totals.totalFacturado += row.total || 0;
      totals.totalBaseImponible += row.subtotal_gravable || 0;
      totals.totalIVA += row.iva || 0;
      totals.totalRetenido += row.monto_retenido || 0;

      if (format === 'txt') {
        // SENIAT TXT format (tab-separated)
        const line = [
          formatRif(row.proveedor_rif),           // 1. RIF Retenido
          row.numero_factura || '',               // 2. Número Factura
          formatControl(row.numero_control),      // 3. Número Control
          formatDate(row.fecha_factura),          // 4. Fecha Operación
          formatNumber(row.total),                // 5. Monto Facturado
          formatNumber(row.subtotal_gravable),    // 6. Base Imponible
          formatNumber(row.iva),                  // 7. Monto IVA
          formatNumber(row.monto_retenido),       // 8. Monto Retenido
          row.numero_comprobante || '',           // 9. Número Comprobante
          'C',                                    // 10. Tipo Operación (C=Compra)
          String(row.retencion_iva_pct || 75),    // 11. % Retención
        ].join('\t');
        exportRows.push(line);
      } else {
        // CSV format (more readable)
        const line = [
          formatRif(row.proveedor_rif),
          `"${row.proveedor_nombre || ''}"`,
          row.numero_factura || '',
          row.numero_control || '',
          formatDate(row.fecha_factura),
          formatNumber(row.total),
          formatNumber(row.subtotal_gravable),
          formatNumber(row.iva),
          formatNumber(row.monto_retenido),
          row.numero_comprobante || '',
          String(row.retencion_iva_pct || 75),
        ].join(',');
        exportRows.push(line);
      }
    }

    // Build file content
    let fileContent: string;
    let contentType: string;
    let fileName: string;

    if (format === 'txt') {
      // SENIAT TXT format - no header, just data
      fileContent = exportRows.join('\r\n');
      contentType = 'text/plain; charset=utf-8';
      fileName = `retenciones_iva_${periodo.replace('-', '')}.txt`;
    } else {
      // CSV format - with header
      const header = 'RIF_Proveedor,Nombre_Proveedor,Num_Factura,Num_Control,Fecha,Total,Base_Imponible,IVA,Monto_Retenido,Num_Comprobante,Pct_Retencion';
      fileContent = header + '\r\n' + exportRows.join('\r\n');
      contentType = 'text/csv; charset=utf-8';
      fileName = `retenciones_iva_${periodo.replace('-', '')}.csv`;
    }

    // Add summary at the end (as comment for TXT, or extra rows for CSV)
    const summaryLines = [
      '',
      format === 'txt' ? '# RESUMEN' : ',,,,,,,,,,',
      format === 'txt'
        ? `# Período: ${periodo}`
        : `RESUMEN,Período: ${periodo},,,,,,,,`,
      format === 'txt'
        ? `# Cantidad de Retenciones: ${totals.cantidadRetenciones}`
        : `Cantidad Retenciones,${totals.cantidadRetenciones},,,,,,,,`,
      format === 'txt'
        ? `# Total Facturado: ${formatNumber(totals.totalFacturado)}`
        : `Total Facturado,${formatNumber(totals.totalFacturado)},,,,,,,,`,
      format === 'txt'
        ? `# Total Base Imponible: ${formatNumber(totals.totalBaseImponible)}`
        : `Total Base Imponible,${formatNumber(totals.totalBaseImponible)},,,,,,,,`,
      format === 'txt'
        ? `# Total IVA: ${formatNumber(totals.totalIVA)}`
        : `Total IVA,${formatNumber(totals.totalIVA)},,,,,,,,`,
      format === 'txt'
        ? `# TOTAL RETENIDO: ${formatNumber(totals.totalRetenido)}`
        : `TOTAL RETENIDO,${formatNumber(totals.totalRetenido)},,,,,,,,`,
    ];

    fileContent += '\r\n' + summaryLines.join('\r\n');

    return new Response(fileContent, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error('Error exporting retenciones:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al exportar retenciones' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
