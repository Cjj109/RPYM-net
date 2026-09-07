import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/require-auth';
import {
  adelantar,
  adelantoEnCurso,
  deshacerAdelanto,
  proximaSinEntrar,
} from '../../../lib/bcv-fuentes';
import { formatDateDMY } from '../../../lib/format';

export const prerender = false;

/**
 * Adelantar la tasa que aún no ha entrado.
 *
 * El BCV publica por la tarde y esa tasa no se cobra hasta el día siguiente.
 * Pero a veces hay que pagarle a un proveedor que ya cobra a la nueva, y hace
 * falta poder adelantarla sin teclear la cifra ni pasar por el modo manual,
 * que se queda fijo hasta que alguien lo apaga.
 *
 * Adelantar escribe en `desde` de esa fila: significa "esta tasa empieza a
 * cobrarse hoy", que es justo lo que quiere decir esa columna. Así lo ven
 * igual el catálogo, los presupuestos, el histórico y los reportes Z, sin que
 * ninguno tenga que enterarse de nada. El porqué está en bcv-fuentes.ts.
 *
 * Ojo con lo que hace: cambia la tasa de TODO el sitio, no solo la de ese
 * pago.
 */

const json = (datos: unknown, status = 200) =>
  new Response(JSON.stringify(datos), { status, headers: { 'Content-Type': 'application/json' } });

export const PUT: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const { adelantar: quiereAdelantar } = (await request.json()) as { adelantar?: boolean };

    if (!quiereAdelantar) {
      await deshacerAdelanto(db);
      return json({ success: true, adelantada: false });
    }

    // Ya hay uno en curso: adelantar otra vez saltaría DOS cambios de tasa,
    // porque la próxima ya no sería la de mañana sino la de pasado.
    if (await adelantoEnCurso(db)) {
      return json({ success: false, error: 'La tasa nueva ya esta adelantada' }, 400);
    }

    // La fila se busca en la tabla, no se acepta del navegador: así no se
    // puede adelantar a una tasa que no existe. Y se lee de D1 directamente,
    // sin salir a la red: el dato ya está apuntado, y hacer las cuatro
    // consultas a las fuentes aquí dejaba el botón colgado medio minuto
    // cuando el BCV iba lento.
    const proxima = await proximaSinEntrar(db);
    if (!proxima) {
      return json({ success: false, error: 'No hay ninguna tasa nueva publicada todavia' }, 400);
    }

    await adelantar(db, proxima);
    return json({
      success: true,
      adelantada: true,
      rate: proxima.rate,
      entrabaEl: formatDateDMY(proxima.desde),
    });
  } catch (error) {
    console.error('Error al adelantar la tasa BCV:', error);
    return json({ success: false, error: 'Error al cambiar la tasa' }, 500);
  }
};

/** Si hay un adelanto en curso y qué tasa viene, para pintar el panel */
export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  const enCurso = await adelantoEnCurso(db);
  const proxima = enCurso ? null : await proximaSinEntrar(db);

  return json({
    success: true,
    adelantada: !!enCurso,
    entrabaEl: enCurso ? formatDateDMY(enCurso.desdeAnterior) : null,
    proxima: proxima ? { rate: proxima.rate, entra: formatDateDMY(proxima.desde) } : null,
  });
};
