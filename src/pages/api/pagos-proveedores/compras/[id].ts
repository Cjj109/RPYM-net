import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../lib/require-auth';
import { getR2 } from '../../../../lib/d1-types';
import type { D1CompraProveedorWithNombre, D1AbonoProveedor } from '../../../../lib/pagos-proveedores-types';
import { transformCompraProveedor } from '../../../../lib/pagos-proveedores-types';

export const prerender = false;

// GET /api/pagos-proveedores/compras/:id - Get single purchase with abonos
export const GET: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const id = params.id;

    const compra = await db.prepare(`
      SELECT c.*, pi.nombre as proveedor_nombre,
        COALESCE((SELECT SUM(a.monto_usd) FROM abonos_proveedores a WHERE a.compra_id = c.id AND a.is_active = 1), 0) as total_abonado
      FROM compras_proveedores c
      JOIN proveedores_informales pi ON c.proveedor_id = pi.id
      WHERE c.id = ? AND c.is_active = 1
    `).bind(id).first<D1CompraProveedorWithNombre>();

    if (!compra) {
      return new Response(JSON.stringify({ success: false, error: 'Compra no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const abonosResult = await db.prepare(
      'SELECT * FROM abonos_proveedores WHERE compra_id = ? AND is_active = 1 ORDER BY fecha DESC, created_at DESC'
    ).bind(id).all<D1AbonoProveedor>();

    return new Response(JSON.stringify({
      success: true,
      compra: transformCompraProveedor(compra, abonosResult.results),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error getting compra:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al cargar compra' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// PUT /api/pagos-proveedores/compras/:id - Update purchase
export const PUT: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const id = params.id;
    const body = await request.json();
    const { proveedorId, producto, montoTotal, montoTotalBs, tasaReferencia, modoPrecio, fecha, tieneFactura, notas, removeNotaEntrega } = body;

    const modo = modoPrecio || 'bcv';

    let finalMontoTotal = Number(montoTotal);
    if (modo === 'bs') {
      if (!montoTotalBs || !tasaReferencia) {
        return new Response(JSON.stringify({ success: false, error: 'Monto en Bs y tasa de referencia son requeridos para modo Bs' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        });
      }
      finalMontoTotal = Number(montoTotalBs) / Number(tasaReferencia);
    }

    if (!proveedorId || !finalMontoTotal || !producto?.trim() || !fecha) {
      return new Response(JSON.stringify({ success: false, error: 'Proveedor, monto total, producto y fecha son requeridos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Remove nota de entrega from R2 if requested
    if (removeNotaEntrega) {
      const compra = await db.prepare(
        'SELECT nota_entrega_key FROM compras_proveedores WHERE id = ?'
      ).bind(id).first<{ nota_entrega_key: string | null }>();

      if (compra?.nota_entrega_key) {
        const r2 = getR2(locals);
        if (r2) {
          try { await r2.delete(compra.nota_entrega_key); } catch (e) { console.error('Error deleting nota entrega:', e); }
        }
      }

      await db.prepare(
        "UPDATE compras_proveedores SET nota_entrega_key = NULL, updated_at = datetime('now') WHERE id = ?"
      ).bind(id).run();
    }

    await db.prepare(`
      UPDATE compras_proveedores
      SET proveedor_id = ?, producto = ?, monto_total = ?, monto_total_bs = ?, tasa_referencia = ?,
          modo_precio = ?, fecha = ?, tiene_factura = ?, notas = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      Number(proveedorId),
      producto.trim(),
      finalMontoTotal,
      modo === 'bs' ? Number(montoTotalBs) : null,
      modo === 'bs' ? Number(tasaReferencia) : null,
      modo,
      fecha,
      tieneFactura ? 1 : 0,
      notas?.trim() || null,
      id
    ).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error updating compra:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al actualizar compra' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// PATCH /api/pagos-proveedores/compras/:id - Toggle pagada_manual
export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const id = params.id;
    const body = await request.json();
    const { pagadaManual, notaPagada } = body;

    await db.prepare(
      "UPDATE compras_proveedores SET pagada_manual = ?, nota_pagada = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(pagadaManual ? 1 : 0, notaPagada ?? null, id).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error toggling pagada_manual:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al actualizar estado' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};

// DELETE /api/pagos-proveedores/compras/:id - Soft delete purchase + abonos
export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const id = params.id;

    // Soft delete compra and all its abonos
    await db.batch([
      db.prepare("UPDATE abonos_proveedores SET is_active = 0, updated_at = datetime('now') WHERE compra_id = ?").bind(id),
      db.prepare("UPDATE compras_proveedores SET is_active = 0, updated_at = datetime('now') WHERE id = ?").bind(id),
    ]);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error deleting compra:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al eliminar compra' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
