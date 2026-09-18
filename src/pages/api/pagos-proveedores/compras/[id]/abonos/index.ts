import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../../../lib/require-auth';

export const prerender = false;

/**
 * Tope de abonos por tanda.
 *
 * Una compra se paga repartida entre las cuentas que tengan saldo ese día:
 * algo de la de PA, algo de la de Carlos, algo de Zelle. Tres o cuatro es lo
 * normal; diez ya es holgado. Por encima de eso no es un pago repartido, es un
 * dedo pegado en el botón de añadir.
 */
const MAX_POR_TANDA = 10;

interface EntradaAbono {
  montoUsd?: unknown;
  fecha?: unknown;
  metodoPago?: unknown;
  cuenta?: unknown;
  notas?: unknown;
  montoBs?: unknown;
  tasaCambio?: unknown;
  tasaParalela?: unknown;
}

/**
 * Número, o null si no viene.
 *
 * El cero cuenta como "no puesto": ni un abono de cero dólares ni una tasa de
 * cero significan nada, y una tasa de cero además reventaría la división.
 * Los negativos sí pasan — así se registran los traslados de saldo a favor.
 */
const numero = (valor: unknown): number | null => {
  const n = Number(valor);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * POST /api/pagos-proveedores/compras/:id/abonos
 *
 * Acepta un abono suelto (como siempre) o `{ abonos: [...] }` para registrar
 * varios de una vez. Lo segundo existe porque a un proveedor se le paga desde
 * varias cuentas el mismo día, y anotarlos de uno en uno era repetir el mismo
 * formulario tres veces.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const compraId = Number(params.id);
    const body = await request.json();
    const entradas: EntradaAbono[] = Array.isArray(body?.abonos) ? body.abonos : [body];
    const enTanda = entradas.length > 1;

    if (entradas.length === 0) {
      return json({ success: false, error: 'No hay abonos que registrar' }, 400);
    }

    if (entradas.length > MAX_POR_TANDA) {
      return json({ success: false, error: `Máximo ${MAX_POR_TANDA} abonos a la vez` }, 400);
    }

    /* Se revisan todos antes de escribir ninguno. Un pago repartido entre tres
       cuentas entra entero o no entra: dejar la compra con dos de los tres
       abonos es peor que no haber guardado nada, porque el saldo que queda en
       pantalla parece bueno y no lo es. */
    for (let i = 0; i < entradas.length; i++) {
      const entrada = entradas[i];
      if (numero(entrada.montoUsd) === null || !entrada.fecha) {
        return json({
          success: false,
          error: enTanda
            ? `Pago ${i + 1}: falta el monto o la fecha`
            : 'Monto y fecha son requeridos',
        }, 400);
      }
    }

    const compra = await db.prepare(
      'SELECT id FROM compras_proveedores WHERE id = ? AND is_active = 1'
    ).bind(compraId).first<{ id: number }>();

    if (!compra) {
      return json({ success: false, error: 'Compra no encontrada' }, 404);
    }

    const sentencias = entradas.map(entrada => db.prepare(`
      INSERT INTO abonos_proveedores (compra_id, monto_usd, monto_bs, tasa_cambio, tasa_paralela, fecha, metodo_pago, cuenta, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      compraId,
      Number(entrada.montoUsd),
      numero(entrada.montoBs),
      numero(entrada.tasaCambio),
      numero(entrada.tasaParalela),
      String(entrada.fecha),
      String(entrada.metodoPago || 'pago_movil'),
      String(entrada.cuenta || 'pa'),
      String(entrada.notas ?? '').trim() || null
    ));

    const resultados = await db.batch(sentencias);
    const ids = resultados.map(r => r.meta.last_row_id);

    /* `id` sigue saliendo para quien manda un abono suelto y lo espera así
       (el traslado de saldo a favor, sin ir más lejos). */
    return json({ success: true, id: ids[0], ids }, 201);
  } catch (error) {
    console.error('Error creating abono:', error);
    return json({ success: false, error: 'Error al registrar abono' }, 500);
  }
};
