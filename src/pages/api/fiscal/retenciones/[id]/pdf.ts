import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../../lib/require-auth';
import { generateComprobanteNumber, type D1FiscalFacturaCompraWithProveedor } from '../../../../../lib/fiscal-types';

export const prerender = false;

interface FacturaWithProveedor extends D1FiscalFacturaCompraWithProveedor {
  proveedor_direccion?: string;
}

// POST /api/fiscal/retenciones/:facturaId/pdf - Generate IVA retention voucher PDF
export const POST: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const facturaId = params.id;

    // Get factura with proveedor details
    const factura = await db.prepare(`
      SELECT f.*, p.nombre as proveedor_nombre, p.rif as proveedor_rif, p.direccion as proveedor_direccion,
             p.retencion_iva_pct
      FROM fiscal_facturas_compra f
      LEFT JOIN fiscal_proveedores p ON f.proveedor_id = p.id
      WHERE f.id = ?
    `).bind(facturaId).first<FacturaWithProveedor & { retencion_iva_pct: number }>();

    if (!factura) {
      return new Response(JSON.stringify({ success: false, error: 'Factura no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Recalculate retention with current provider percentage
    const montoRetenido = factura.iva * (factura.retencion_iva_pct / 100);

    // Check if retencion already exists
    const existingRetencion = await db.prepare(
      'SELECT id, numero_comprobante FROM fiscal_retenciones_iva WHERE factura_id = ?'
    ).bind(facturaId).first<{ id: number; numero_comprobante: string }>();

    // Get current period
    const now = new Date();
    const periodoFiscal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    let numeroComprobante: string;
    let retencionId: number;

    if (existingRetencion) {
      // Use existing but update monto_retenido with current percentage
      numeroComprobante = existingRetencion.numero_comprobante;
      retencionId = existingRetencion.id;

      // Update the retention amount in case provider percentage changed
      await db.prepare(`
        UPDATE fiscal_retenciones_iva SET monto_retenido = ? WHERE id = ?
      `).bind(montoRetenido, retencionId).run();
    } else {
      // Generate new comprobante number
      const count = await db.prepare(`
        SELECT COUNT(*) + 1 as next_seq
        FROM fiscal_retenciones_iva
        WHERE periodo_fiscal = ?
      `).bind(periodoFiscal).first<{ next_seq: number }>();

      numeroComprobante = generateComprobanteNumber(now.getFullYear(), now.getMonth() + 1, count?.next_seq || 1);

      // Create retencion record with recalculated amount
      const result = await db.prepare(`
        INSERT INTO fiscal_retenciones_iva (
          factura_id, numero_comprobante, fecha_emision, periodo_fiscal, monto_retenido
        ) VALUES (?, ?, ?, ?, ?)
      `).bind(
        facturaId,
        numeroComprobante,
        now.toISOString().split('T')[0],
        periodoFiscal,
        montoRetenido
      ).run();

      retencionId = result.meta.last_row_id;
    }

    // Generate PDF using jsPDF (client-side library, so we'll return data for client to generate)
    // For server-side, we return the data needed to generate the PDF on the client
    const pdfData = {
      comprobante: {
        numero: numeroComprobante,
        fechaEmision: now.toISOString().split('T')[0],
        periodoFiscal,
      },
      empresa: {
        nombre: 'EL REY DE LOS PESCADOS Y MARISCOS RPYM, F.P',
        rif: 'E816000567',
        direccion: 'CALLE LOS MOLINOS ENTRADA PRINCIPAL LOCAL PESQUERO NRO 3 Y 4 URB. MAIQUETIA',
      },
      proveedor: {
        nombre: factura.proveedor_nombre,
        rif: factura.proveedor_rif,
        direccion: factura.proveedor_direccion || '',
      },
      factura: {
        numero: factura.numero_factura,
        numeroControl: factura.numero_control,
        fecha: factura.fecha_factura,
        subtotalGravable: factura.subtotal_gravable,
        iva: factura.iva,
        total: factura.total,
      },
      retencion: {
        porcentaje: factura.retencion_iva_pct,
        monto: montoRetenido,
      },
    };

    return new Response(JSON.stringify({
      success: true,
      retencionId,
      pdfData,
      pdfUrl: null, // Client will generate PDF
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error generating retencion PDF:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error generando comprobante' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
