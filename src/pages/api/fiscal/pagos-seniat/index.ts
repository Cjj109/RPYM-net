import type { APIRoute } from 'astro';
import { getR2 } from '../../../../lib/d1-types';
import { requireAuth } from '../../../../lib/require-auth';
import { transformPagoSeniat, type D1FiscalPagoSeniat } from '../../../../lib/fiscal-types';

export const prerender = false;

// GET /api/fiscal/pagos-seniat?periodo=YYYY-MM
export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const url = new URL(request.url);
    const periodo = url.searchParams.get('periodo');
    const year = url.searchParams.get('year');

    let results;
    if (periodo) {
      results = await db.prepare(
        'SELECT * FROM fiscal_pagos_seniat WHERE periodo = ? ORDER BY tipo_pago, created_at DESC'
      ).bind(periodo).all<D1FiscalPagoSeniat>();
    } else if (year) {
      results = await db.prepare(
        'SELECT * FROM fiscal_pagos_seniat WHERE periodo LIKE ? ORDER BY periodo DESC, fecha_pago DESC'
      ).bind(`${year}%`).all<D1FiscalPagoSeniat>();
    } else {
      results = await db.prepare(
        'SELECT * FROM fiscal_pagos_seniat ORDER BY periodo DESC, fecha_pago DESC'
      ).all<D1FiscalPagoSeniat>();
    }

    return new Response(JSON.stringify({
      success: true,
      pagos: results.results.map(transformPagoSeniat),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error listing pagos SENIAT:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al cargar pagos SENIAT' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// POST /api/fiscal/pagos-seniat - Create payment record (multipart/form-data or JSON)
export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;
  const r2 = getR2(locals);

  try {
    let periodo: string;
    let tipoPago: string;
    let concepto: string | null = null;
    let quincena: number | null = null;
    let fechaPago: string;
    let monto: number;
    let numeroPlanilla: string | null = null;
    let referenciaBancaria: string | null = null;
    let banco: string | null = null;
    let notes: string | null = null;
    let imageKey: string | null = null;

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      periodo = formData.get('periodo') as string;
      tipoPago = formData.get('tipoPago') as string;
      concepto = (formData.get('concepto') as string) || null;
      quincena = formData.get('quincena') ? parseInt(formData.get('quincena') as string) : null;
      fechaPago = formData.get('fechaPago') as string;
      monto = parseFloat(formData.get('monto') as string);
      numeroPlanilla = (formData.get('numeroPlanilla') as string) || null;
      referenciaBancaria = (formData.get('referenciaBancaria') as string) || null;
      banco = (formData.get('banco') as string) || null;
      notes = (formData.get('notes') as string) || null;

      const imageFile = formData.get('image') as File | null;
      if (imageFile && imageFile.size > 0 && r2) {
        if (imageFile.size > 5 * 1024 * 1024) {
          return new Response(JSON.stringify({ success: false, error: 'Imagen muy grande (máximo 5MB)' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const fileType = imageFile.type?.toLowerCase() || 'image/jpeg';
        const ext = fileType.includes('png') ? 'png' : fileType.includes('webp') ? 'webp' : 'jpg';
        imageKey = `fiscal/comprobante-seniat/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const arrayBuffer = await imageFile.arrayBuffer();
        await r2.put(imageKey, arrayBuffer, {
          httpMetadata: { contentType: fileType },
        });
      }
    } else {
      const body = await request.json();
      periodo = body.periodo;
      tipoPago = body.tipoPago;
      concepto = body.concepto || null;
      quincena = body.quincena ?? null;
      fechaPago = body.fechaPago;
      monto = body.monto;
      numeroPlanilla = body.numeroPlanilla || null;
      referenciaBancaria = body.referenciaBancaria || null;
      banco = body.banco || null;
      notes = body.notes || null;
    }

    // Validaciones
    if (!periodo || !tipoPago || !fechaPago || (monto == null || isNaN(monto))) {
      return new Response(JSON.stringify({ success: false, error: 'Campos requeridos: periodo, tipoPago, fechaPago, monto' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const tiposValidos = ['pago1', 'pago2', 'sumat', 'otro'];
    if (!tiposValidos.includes(tipoPago)) {
      return new Response(JSON.stringify({ success: false, error: 'Tipo de pago inválido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await db.prepare(`
      INSERT INTO fiscal_pagos_seniat (
        periodo, tipo_pago, concepto, quincena, fecha_pago, monto,
        numero_planilla, referencia_bancaria, banco, image_key, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      periodo, tipoPago, concepto, quincena, fechaPago, monto,
      numeroPlanilla, referenciaBancaria, banco, imageKey, notes
    ).run();

    return new Response(JSON.stringify({
      success: true,
      id: result.meta.last_row_id,
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error creating pago SENIAT:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al registrar pago SENIAT' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
