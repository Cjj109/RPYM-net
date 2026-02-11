/**
 * RPYM - Telegram handlers para presupuestos
 * Handlers que devuelven mensajes formateados para Telegram
 */

import type { D1Database } from '../../d1-types';
import { getProducts, getBCVRate } from '../../sheets';
import { getAdminPresupuestoUrl } from '../../admin-token';
import { findCustomerByName } from '../../repositories/customers';

export const PAYMENT_METHOD_NAMES: Record<string, string> = {
  pago_movil: 'Pago Móvil',
  transferencia: 'Transferencia',
  zelle: 'Zelle',
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  usdt: 'USDT',
  binance: 'Binance',
};

export interface BudgetEdit {
  tipo: 'precio' | 'precio_divisa' | 'fecha' | 'quitar' | 'agregar' | 'cantidad' | 'cliente' | 'delivery' | 'sustituir' | 'restar';
  producto?: string;
  precio?: number;
  precioBcv?: number;
  precioDivisa?: number;
  cantidad?: number;
  unidad?: string;
  fecha?: string;
  nombre?: string;
  monto?: number;
  productoOriginal?: string;
  productoNuevo?: string;
}

export async function getBudget(db: D1Database | null, budgetId: string, adminSecret: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const budget = await db.prepare(`SELECT * FROM presupuestos WHERE id = ?`).bind(budgetId).first();
    if (!budget) return `❌ No encontré presupuesto #${budgetId}`;
    const items = JSON.parse(budget.items);
    const estado = budget.estado === 'pagado' ? '✅ PAGADO' : '⏳ PENDIENTE';
    let text = `📋 *Presupuesto #${budget.id}*\n${estado}\n`;
    if (budget.customer_name) text += `👤 ${budget.customer_name}\n`;
    text += `\n`;
    items.forEach((item: any) => text += `• ${item.nombre} x ${item.cantidad}: $${item.subtotalUSD.toFixed(2)}\n`);
    text += `\n*Total: $${budget.total_usd.toFixed(2)}*`;
    if (budget.total_usd_divisa) text += ` / DIV: $${budget.total_usd_divisa.toFixed(2)}`;
    const adminUrl = await getAdminPresupuestoUrl(budget.id, adminSecret, 'https://rpym.net');
    text += `\n🔗 ${adminUrl}`;
    return text;
  } catch (error) {
    return '❌ Error al obtener presupuesto';
  }
}

export async function searchBudgetsByCustomer(db: D1Database | null, customerName: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const searchTerm = customerName.toLowerCase();
    const budgets = await db.prepare(`
      SELECT id, fecha, customer_name, total_usd, total_usd_divisa, modo_precio
      FROM presupuestos
      WHERE estado = 'pendiente'
        AND LOWER(customer_name) LIKE ?
      ORDER BY fecha DESC
      LIMIT 10
    `).bind(`%${searchTerm}%`).all();

    if (!budgets?.results?.length) {
      return `📋 No encontré presupuestos pendientes para "*${customerName}*"`;
    }

    let text = `📋 *Presupuestos pendientes de "${customerName}"*\n\n`;
    let totalDeuda = 0;

    budgets.results.forEach((b: any) => {
      const fecha = b.fecha ? b.fecha.split(' ')[0] : 'Sin fecha';
      const isDual = b.modo_precio === 'dual' && b.total_usd_divisa;
      text += `• #${b.id} - ${fecha}\n`;
      text += `  💵 $${b.total_usd.toFixed(2)}${isDual ? ` / DIV: $${b.total_usd_divisa.toFixed(2)}` : ''}\n`;
      totalDeuda += b.total_usd;
    });

    text += `\n*Total pendiente: $${totalDeuda.toFixed(2)}* (${budgets.results.length} presupuesto${budgets.results.length > 1 ? 's' : ''})`;

    return text;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

export async function deleteBudget(db: D1Database | null, budgetId: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const budget = await db.prepare(`SELECT id, customer_name, total_usd FROM presupuestos WHERE id = ?`).bind(budgetId).first();
    if (!budget) return `❌ No encontré presupuesto #${budgetId}`;
    await db.prepare(`DELETE FROM presupuestos WHERE id = ?`).bind(budgetId).run();
    return `🗑️ *Presupuesto #${budgetId} eliminado*\n${budget.customer_name ? `👤 ${budget.customer_name}\n` : ''}💵 $${budget.total_usd.toFixed(2)}`;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

export async function markBudgetPaid(db: D1Database | null, budgetId: string, paymentMethod?: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const budget = await db.prepare(`SELECT id, estado, customer_name, total_usd FROM presupuestos WHERE id = ?`).bind(budgetId).first();
    if (!budget) return `❌ No encontré presupuesto #${budgetId}`;
    if (budget.estado === 'pagado' && !paymentMethod) return `ℹ️ Presupuesto #${budgetId} ya está pagado`;

    if (paymentMethod) {
      await db.prepare(`UPDATE presupuestos SET estado = 'pagado', fecha_pago = datetime('now', '-4 hours'), payment_method = ? WHERE id = ?`).bind(paymentMethod, budgetId).run();
    } else {
      await db.prepare(`UPDATE presupuestos SET estado = 'pagado', fecha_pago = datetime('now', '-4 hours') WHERE id = ?`).bind(budgetId).run();
    }

    const txResult = await db.prepare(`
      UPDATE customer_transactions
      SET is_paid = 1, paid_date = datetime('now', '-4 hours')${paymentMethod ? `, payment_method = '${paymentMethod}'` : ''}
      WHERE presupuesto_id = ?
    `).bind(budgetId).run();

    let response = `✅ *Presupuesto #${budgetId}* marcado como *PAGADO*`;
    if (paymentMethod) {
      response += ` (${PAYMENT_METHOD_NAMES[paymentMethod] || paymentMethod})`;
    }
    if (txResult?.meta?.changes > 0) {
      response += `\n💼 Transacción del cliente también marcada como pagada`;
    }
    if (budget.customer_name) {
      response += `\n👤 ${budget.customer_name}`;
    }
    return response;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

export async function updatePaymentMethod(db: D1Database | null, budgetId: string, paymentMethod: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const budget = await db.prepare(`SELECT id, estado, customer_name FROM presupuestos WHERE id = ?`).bind(budgetId).first();
    if (!budget) return `❌ No encontré presupuesto #${budgetId}`;

    await db.prepare(`UPDATE presupuestos SET payment_method = ? WHERE id = ?`).bind(paymentMethod, budgetId).run();
    await db.prepare(`UPDATE customer_transactions SET payment_method = ? WHERE presupuesto_id = ?`).bind(paymentMethod, budgetId).run();

    return `✅ Método de pago de #${budgetId} actualizado a *${PAYMENT_METHOD_NAMES[paymentMethod] || paymentMethod}*`;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

export async function updateBudgetProperty(db: D1Database | null, budgetId: string, change: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const budget = await db.prepare(`SELECT id, customer_name, hide_rate FROM presupuestos WHERE id = ?`).bind(budgetId).first();
    if (!budget) return `❌ No encontré presupuesto #${budgetId}`;

    if (change === 'ocultar_bs') {
      await db.prepare(`UPDATE presupuestos SET hide_rate = 1 WHERE id = ?`).bind(budgetId).run();
      return `✅ Presupuesto #${budgetId} actualizado - *Bs ocultos*${budget.customer_name ? `\n👤 ${budget.customer_name}` : ''}`;
    } else if (change === 'mostrar_bs') {
      await db.prepare(`UPDATE presupuestos SET hide_rate = 0 WHERE id = ?`).bind(budgetId).run();
      return `✅ Presupuesto #${budgetId} actualizado - *Bs visibles*${budget.customer_name ? `\n👤 ${budget.customer_name}` : ''}`;
    }

    return `❓ Cambio no reconocido: ${change}`;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

export async function editBudget(db: D1Database | null, budgetId: string, edicion: BudgetEdit): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const budget = await db.prepare(`
      SELECT id, items, total_usd, total_bs, total_usd_divisa, customer_name, fecha, modo_precio, delivery
      FROM presupuestos WHERE id = ?
    `).bind(budgetId).first();

    if (!budget) return `❌ No encontré presupuesto #${budgetId}`;

    let items = typeof budget.items === 'string' ? JSON.parse(budget.items) : budget.items;
    let mensaje = '';

    const bcvRate = await getBCVRate();

    switch (edicion.tipo) {
      case 'precio': {
        const producto = edicion.producto?.toLowerCase();
        const itemIndex = items.findIndex((i: any) => i.nombre.toLowerCase().includes(producto || ''));
        if (itemIndex === -1) return `❌ No encontré "${edicion.producto}" en el presupuesto`;

        const item = items[itemIndex];
        const oldPrice = item.precioUSD;
        item.precioUSD = edicion.precio!;
        item.precioBs = edicion.precio! * bcvRate.rate;
        item.subtotalUSD = item.precioUSD * item.cantidad;
        item.subtotalBs = item.precioBs * item.cantidad;

        if (edicion.precioDivisa) {
          item.precioUSDDivisa = edicion.precioDivisa;
          item.subtotalUSDDivisa = edicion.precioDivisa * item.cantidad;
        } else if (item.precioUSDDivisa) {
          item.subtotalUSDDivisa = item.precioUSDDivisa * item.cantidad;
        }

        mensaje = `✏️ Precio de *${item.nombre}* cambiado: $${oldPrice.toFixed(2)} → $${edicion.precio!.toFixed(2)}`;
        break;
      }

      case 'precio_divisa': {
        if (items.length === 1) {
          const item = items[0];
          item.precioUSDDivisa = edicion.precio!;
          item.subtotalUSDDivisa = edicion.precio! * item.cantidad;
          mensaje = `✏️ Precio divisa de *${item.nombre}* cambiado a $${edicion.precio!.toFixed(2)}`;
        } else {
          return `❓ Hay varios productos. Especifica cuál: "el precio del [producto] era $X"`;
        }
        break;
      }

      case 'fecha': {
        await db.prepare(`UPDATE presupuestos SET fecha = ? WHERE id = ?`).bind(edicion.fecha + ' 12:00:00', budgetId).run();
        return `✅ Fecha de #${budgetId} cambiada a *${edicion.fecha}*`;
      }

      case 'quitar': {
        const producto = edicion.producto?.toLowerCase();
        const itemIndex = items.findIndex((i: any) => i.nombre.toLowerCase().includes(producto || ''));
        if (itemIndex === -1) return `❌ No encontré "${edicion.producto}" en el presupuesto`;

        const removed = items.splice(itemIndex, 1)[0];
        mensaje = `🗑️ *${removed.nombre}* eliminado del presupuesto`;
        break;
      }

      case 'agregar': {
        const modoPrecioRaw = budget.modo_precio || 'bcv';
        const modoPrecio = modoPrecioRaw === 'divisa' ? 'divisas' : modoPrecioRaw;
        const cantidadAgregar = edicion.cantidad || 1;
        const productoNombre = (edicion.producto || '').toLowerCase();

        const existingItemIndex = items.findIndex((i: any) =>
          i.nombre.toLowerCase().includes(productoNombre) ||
          productoNombre.includes(i.nombre.toLowerCase())
        );

        if (existingItemIndex !== -1 && !edicion.precio && !edicion.precioBcv) {
          const item = items[existingItemIndex];
          const oldQty = item.cantidad;
          item.cantidad += cantidadAgregar;
          item.subtotalUSD = item.precioUSD * item.cantidad;
          item.subtotalBs = item.precioBs * item.cantidad;
          if (item.precioUSDDivisa) {
            item.subtotalUSDDivisa = item.precioUSDDivisa * item.cantidad;
          }

          if (modoPrecio === 'divisas') {
            mensaje = `➕ *${item.nombre}*: ${oldQty} + ${cantidadAgregar} = ${item.cantidad}${item.unidad} x $${item.precioUSD.toFixed(2)} (DIV)`;
          } else if (modoPrecio === 'dual') {
            mensaje = `➕ *${item.nombre}*: ${oldQty} + ${cantidadAgregar} = ${item.cantidad}${item.unidad} x $${item.precioUSD.toFixed(2)} / DIV: $${item.precioUSDDivisa.toFixed(2)}`;
          } else {
            mensaje = `➕ *${item.nombre}*: ${oldQty} + ${cantidadAgregar} = ${item.cantidad}${item.unidad} x $${item.precioUSD.toFixed(2)}`;
          }
          break;
        }

        let precioBCV = edicion.precioBcv || edicion.precio || 0;
        let precioDivisa = edicion.precioDivisa || precioBCV;
        let nombreProducto = edicion.producto || 'Producto';

        if (!edicion.precio && !edicion.precioBcv) {
          const products = await getProducts(bcvRate.rate, db);
          const foundProduct = products.find(p =>
            p.nombre.toLowerCase().includes(productoNombre) ||
            productoNombre.includes(p.nombre.toLowerCase())
          );
          if (foundProduct) {
            precioBCV = foundProduct.precioUSD;
            precioDivisa = foundProduct.precioUSDDivisa || foundProduct.precioUSD;
            nombreProducto = foundProduct.nombre;
          }
        }

        let precioParaItem: number;
        let subtotalParaItem: number;

        if (modoPrecio === 'divisas') {
          precioParaItem = precioDivisa;
          subtotalParaItem = precioDivisa * cantidadAgregar;
        } else {
          precioParaItem = precioBCV;
          subtotalParaItem = precioBCV * cantidadAgregar;
        }

        const newItem = {
          nombre: nombreProducto,
          cantidad: cantidadAgregar,
          unidad: edicion.unidad || 'kg',
          precioUSD: precioParaItem,
          precioBs: precioParaItem * bcvRate.rate,
          subtotalUSD: subtotalParaItem,
          subtotalBs: subtotalParaItem * bcvRate.rate,
          precioUSDDivisa: modoPrecio === 'dual' ? precioDivisa : precioParaItem,
          subtotalUSDDivisa: modoPrecio === 'dual' ? precioDivisa * cantidadAgregar : subtotalParaItem
        };
        items.push(newItem);

        if (modoPrecio === 'divisas') {
          mensaje = `➕ *${newItem.nombre}* agregado: ${cantidadAgregar}${newItem.unidad} x $${precioDivisa.toFixed(2)} (DIV)`;
        } else if (modoPrecio === 'dual') {
          mensaje = `➕ *${newItem.nombre}* agregado: ${cantidadAgregar}${newItem.unidad} x $${precioBCV.toFixed(2)} / DIV: $${precioDivisa.toFixed(2)}`;
        } else {
          mensaje = `➕ *${newItem.nombre}* agregado: ${cantidadAgregar}${newItem.unidad} x $${precioBCV.toFixed(2)}`;
        }
        break;
      }

      case 'cantidad': {
        const producto = edicion.producto?.toLowerCase();
        let itemIndex = 0;
        if (producto) {
          itemIndex = items.findIndex((i: any) => i.nombre.toLowerCase().includes(producto));
          if (itemIndex === -1) return `❌ No encontré "${edicion.producto}"`;
        } else if (items.length > 1) {
          return `❓ Hay varios productos. Especifica cuál: "cambia la cantidad del [producto] a X"`;
        }

        const item = items[itemIndex];
        const oldQty = item.cantidad;
        item.cantidad = edicion.cantidad!;
        item.subtotalUSD = item.precioUSD * item.cantidad;
        item.subtotalBs = item.precioBs * item.cantidad;
        if (item.precioUSDDivisa) {
          item.subtotalUSDDivisa = item.precioUSDDivisa * item.cantidad;
        }

        mensaje = `✏️ Cantidad de *${item.nombre}* cambiada: ${oldQty} → ${edicion.cantidad}`;
        break;
      }

      case 'restar': {
        const productoRestar = edicion.producto?.toLowerCase();
        if (!productoRestar) return `❌ Especifica qué producto quieres restar`;

        const itemIdx = items.findIndex((i: any) =>
          i.nombre.toLowerCase().includes(productoRestar) ||
          productoRestar.includes(i.nombre.toLowerCase())
        );
        if (itemIdx === -1) return `❌ No encontré "${edicion.producto}" en el presupuesto`;

        const item = items[itemIdx];
        const cantidadRestar = edicion.cantidad || 1;
        const cantidadAnterior = item.cantidad;
        const nuevaCantidad = cantidadAnterior - cantidadRestar;

        if (nuevaCantidad <= 0) {
          items.splice(itemIdx, 1);
          mensaje = `🗑️ *${item.nombre}* eliminado (${cantidadAnterior} - ${cantidadRestar} = 0)`;
        } else {
          item.cantidad = nuevaCantidad;
          item.subtotalUSD = item.precioUSD * nuevaCantidad;
          item.subtotalBs = item.precioBs * nuevaCantidad;
          if (item.precioUSDDivisa) {
            item.subtotalUSDDivisa = item.precioUSDDivisa * nuevaCantidad;
          }
          mensaje = `➖ *${item.nombre}*: ${cantidadAnterior} - ${cantidadRestar} = ${nuevaCantidad}${item.unidad}`;
        }
        break;
      }

      case 'cliente': {
        await db.prepare(`UPDATE presupuestos SET customer_name = ? WHERE id = ?`).bind(edicion.nombre, budgetId).run();
        return `✅ Cliente de #${budgetId} cambiado a *${edicion.nombre}*`;
      }

      case 'delivery': {
        const nuevoDelivery = edicion.monto || 0;

        await db.prepare(`UPDATE presupuestos SET delivery = ? WHERE id = ?`).bind(nuevoDelivery, budgetId).run();

        const itemsTotal = items.reduce((sum: number, i: any) => sum + i.subtotalUSD, 0);
        const itemsTotalBs = items.reduce((sum: number, i: any) => sum + i.subtotalBs, 0);
        const itemsTotalDivisa = items.reduce((sum: number, i: any) => sum + (i.subtotalUSDDivisa || i.subtotalUSD), 0);

        const newTotalUSD = itemsTotal + nuevoDelivery;
        const newTotalBs = itemsTotalBs + (nuevoDelivery * bcvRate.rate);
        const newTotalDivisa = itemsTotalDivisa + nuevoDelivery;

        await db.prepare(`
          UPDATE presupuestos SET total_usd = ?, total_bs = ?, total_usd_divisa = ?
          WHERE id = ?
        `).bind(newTotalUSD, newTotalBs, budget.modo_precio !== 'bcv' ? newTotalDivisa : null, budgetId).run();

        await db.prepare(`
          UPDATE customer_transactions SET amount_usd = ?, amount_bs = ?, amount_usd_divisa = ?
          WHERE presupuesto_id = ?
        `).bind(newTotalUSD, newTotalBs, budget.modo_precio === 'dual' ? newTotalDivisa : null, budgetId).run();

        if (nuevoDelivery > 0) {
          mensaje = `🚗 Delivery actualizado: $${nuevoDelivery.toFixed(2)}`;
        } else {
          mensaje = `🚗 Delivery eliminado`;
        }
        mensaje += `\n\n📋 *Presupuesto #${budgetId}*`;
        if (budget.customer_name) mensaje += `\n👤 ${budget.customer_name}`;
        mensaje += `\n💵 Total: $${newTotalUSD.toFixed(2)}`;
        if (budget.modo_precio !== 'bcv') mensaje += ` / DIV: $${newTotalDivisa.toFixed(2)}`;

        return mensaje;
      }

      case 'sustituir': {
        const productoOriginal = edicion.productoOriginal?.toLowerCase();
        const productoNuevo = edicion.productoNuevo || '';

        let itemIndex = -1;
        if (productoOriginal) {
          itemIndex = items.findIndex((i: any) => i.nombre.toLowerCase().includes(productoOriginal));
        } else if (items.length === 1) {
          itemIndex = 0;
        }

        if (itemIndex === -1) {
          return `❌ No encontré "${edicion.productoOriginal || 'el producto'}" en el presupuesto`;
        }

        const item = items[itemIndex];
        const oldName = item.nombre;

        const products = await getProducts(bcvRate.rate, db);
        const newProduct = products.find(p =>
          p.nombre.toLowerCase().includes(productoNuevo.toLowerCase()) ||
          productoNuevo.toLowerCase().includes(p.nombre.toLowerCase())
        );

        if (newProduct) {
          const modoPrecioRaw = budget.modo_precio || 'bcv';
          const modoPrecio = modoPrecioRaw === 'divisa' ? 'divisas' : modoPrecioRaw;
          const precioBCV = newProduct.precioUSD;
          const precioDivisa = newProduct.precioUSDDivisa || newProduct.precioUSD;

          let precioParaItem: number;
          if (modoPrecio === 'divisas') {
            precioParaItem = precioDivisa;
          } else {
            precioParaItem = precioBCV;
          }

          item.nombre = newProduct.nombre;
          item.precioUSD = precioParaItem;
          item.precioBs = precioParaItem * bcvRate.rate;
          item.subtotalUSD = precioParaItem * item.cantidad;
          item.subtotalBs = precioParaItem * item.cantidad * bcvRate.rate;
          item.precioUSDDivisa = modoPrecio === 'dual' ? precioDivisa : precioParaItem;
          item.subtotalUSDDivisa = modoPrecio === 'dual' ? precioDivisa * item.cantidad : precioParaItem * item.cantidad;

          if (modoPrecio === 'divisas') {
            mensaje = `🔄 *${oldName}* → *${newProduct.nombre}*\n💰 Precio: $${precioDivisa.toFixed(2)} (DIV)`;
          } else if (modoPrecio === 'dual') {
            mensaje = `🔄 *${oldName}* → *${newProduct.nombre}*\n💰 Precio: $${precioBCV.toFixed(2)} / DIV: $${precioDivisa.toFixed(2)}`;
          } else {
            mensaje = `🔄 *${oldName}* → *${newProduct.nombre}*\n💰 Precio: $${precioBCV.toFixed(2)}`;
          }
        } else {
          item.nombre = productoNuevo;
          mensaje = `🔄 *${oldName}* → *${productoNuevo}*\n⚠️ Producto no encontrado en lista, precio sin cambios`;
        }
        break;
      }
    }

    const delivery = budget.delivery || 0;
    const itemsTotalUSD = items.reduce((sum: number, i: any) => sum + i.subtotalUSD, 0);
    const itemsTotalBs = items.reduce((sum: number, i: any) => sum + i.subtotalBs, 0);
    const itemsTotalDivisa = items.reduce((sum: number, i: any) => sum + (i.subtotalUSDDivisa || i.subtotalUSD), 0);

    const totalUSD = itemsTotalUSD + delivery;
    const totalBs = itemsTotalBs + (delivery * bcvRate.rate);
    const totalUSDDivisa = itemsTotalDivisa + delivery;

    await db.prepare(`
      UPDATE presupuestos SET items = ?, total_usd = ?, total_bs = ?, total_usd_divisa = ?
      WHERE id = ?
    `).bind(JSON.stringify(items), totalUSD, totalBs, budget.modo_precio !== 'bcv' ? totalUSDDivisa : null, budgetId).run();

    await db.prepare(`
      UPDATE customer_transactions SET amount_usd = ?, amount_bs = ?, amount_usd_divisa = ?
      WHERE presupuesto_id = ?
    `).bind(totalUSD, totalBs, budget.modo_precio === 'dual' ? totalUSDDivisa : null, budgetId).run();

    mensaje += `\n\n📋 *Presupuesto #${budgetId}*`;
    if (budget.customer_name) mensaje += `\n👤 ${budget.customer_name}`;
    const modoPrecioFinal = budget.modo_precio === 'divisa' ? 'divisas' : budget.modo_precio;
    if (modoPrecioFinal === 'divisas') {
      mensaje += `\n💵 Total: $${totalUSDDivisa.toFixed(2)} (DIV)`;
    } else if (modoPrecioFinal === 'dual') {
      mensaje += `\n💵 Total: $${totalUSD.toFixed(2)} / DIV: $${totalUSDDivisa.toFixed(2)}`;
    } else {
      mensaje += `\n💵 Total: $${totalUSD.toFixed(2)}`;
    }
    if (delivery > 0) mensaje += `\n🚗 (incl. delivery $${delivery.toFixed(2)})`;

    return mensaje;
  } catch (error) {
    console.error('[Telegram] Error editando presupuesto:', error);
    return `❌ Error: ${error}`;
  }
}

export async function sendBudgetWhatsApp(db: D1Database | null, budgetId: string, phone: string, baseUrl: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const budget = await db.prepare(`SELECT * FROM presupuestos WHERE id = ?`).bind(budgetId).first();
    if (!budget) return `❌ No encontré presupuesto #${budgetId}`;
    const items = JSON.parse(budget.items);
    const digits = phone.replace(/\D/g, '');
    let formattedPhone: string;
    if (digits.startsWith('58') && digits.length === 12) formattedPhone = digits;
    else if (digits.startsWith('0') && digits.length === 11) formattedPhone = '58' + digits.substring(1);
    else if (digits.length === 10 && digits.startsWith('4')) formattedPhone = '58' + digits;
    else return `❌ Teléfono inválido: ${phone}`;

    const modoPrecio = budget.modo_precio === 'divisas' ? 'divisa' : (budget.modo_precio || 'bcv');
    const shouldIncludeBs = modoPrecio === 'bcv' || modoPrecio === 'dual';

    const bcvRate = await getBCVRate();
    const dynamicTotalBs = shouldIncludeBs ? budget.total_usd * bcvRate.rate : 0;

    const response = await fetch(`${baseUrl}/api/send-whatsapp-factura`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: formattedPhone,
        facturaId: budget.id,
        customerName: budget.customer_name || 'Cliente',
        items: items.map((item: any) => ({
          producto: item.nombre,
          cantidad: item.cantidad,
          unidad: item.unidad,
          precioUnit: item.precioUSD,
          subtotal: item.subtotalUSD,
          precioUnitDivisa: item.precioUSDDivisa,
          subtotalDivisa: item.subtotalUSDDivisa
        })),
        total: budget.total_usd,
        totalBs: dynamicTotalBs,
        totalUSDDivisa: budget.total_usd_divisa,
        date: new Date(budget.fecha).toLocaleDateString('es-VE'),
        isPaid: budget.estado === 'pagado',
        delivery: budget.delivery || 0,
        modoPrecio: modoPrecio
      }),
    });
    const result = await response.json();
    if (!result.success) return `❌ Error: ${result.error}`;
    return `✅ *PDF de presupuesto #${budgetId} enviado*\n📱 ${phone}`;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

export async function linkBudgetToCustomer(db: D1Database | null, budgetId: string, customerNameOrId: string | number): Promise<{ success: boolean; message: string; customerId?: number }> {
  if (!db) return { success: false, message: '❌ No hay conexión a la base de datos' };

  try {
    const budget = await db.prepare(`SELECT * FROM presupuestos WHERE id = ?`).bind(budgetId).first();
    if (!budget) return { success: false, message: `❌ No encontré presupuesto #${budgetId}` };

    const existingTx = await db.prepare(`SELECT id FROM customer_transactions WHERE presupuesto_id = ?`).bind(budgetId).first();
    if (existingTx) return { success: false, message: `⚠️ Presupuesto #${budgetId} ya está asignado a una cuenta` };

    let customer: any;
    if (typeof customerNameOrId === 'number') {
      customer = await db.prepare(`SELECT id, name FROM customers WHERE id = ? AND is_active = 1`).bind(customerNameOrId).first();
    } else {
      customer = await findCustomerByName(db, customerNameOrId);
    }

    if (!customer) return { success: false, message: `❌ No encontré cliente "${customerNameOrId}"` };

    const items = JSON.parse(budget.items || '[]');
    const description = items.map((i: any) => `${i.nombre} ${i.cantidad}${i.unidad || 'kg'}`).join(', ') || `Presupuesto #${budgetId}`;
    const currencyType = (budget.modo_precio === 'divisas' || budget.modo_precio === 'divisa') ? 'divisas' : 'dolar_bcv';
    const bcvRate = await getBCVRate();

    await db.prepare(`
      INSERT INTO customer_transactions
      (customer_id, type, date, description, amount_usd, amount_bs, amount_usd_divisa, currency_type, presupuesto_id, exchange_rate, is_paid)
      VALUES (?, datetime(?, 'localtime'), ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).bind(
      customer.id,
      budget.fecha,
      description,
      budget.total_usd,
      budget.total_bs,
      budget.modo_precio === 'dual' ? budget.total_usd_divisa : null,
      currencyType,
      budgetId,
      bcvRate.rate,
    ).run();

    if (!budget.customer_name) {
      await db.prepare(`UPDATE presupuestos SET customer_name = ? WHERE id = ?`).bind(customer.name, budgetId).run();
    }

    return {
      success: true,
      message: `✅ Presupuesto #${budgetId} asignado a *${customer.name}*`,
      customerId: customer.id
    };
  } catch (error) {
    console.error('[Telegram] Error linking budget to customer:', error);
    return { success: false, message: `❌ Error: ${error}` };
  }
}

export async function createBudgetFromText(db: D1Database | null, text: string, mode: string, baseUrl: string, apiKey: string, adminSecret: string, hideRate: boolean = false): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const bcvRate = await getBCVRate();
    const products = await getProducts(bcvRate.rate, db);
    const productList = products.map(p => ({
      id: String(p.id), nombre: p.nombre, unidad: p.unidad, precioUSD: p.precioUSD, precioUSDDivisa: p.precioUSDDivisa
    }));

    const response = await fetch(`${baseUrl}/api/parse-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, products: productList }),
    });
    const result = await response.json();

    if (!result.success || !result.items?.length) {
      console.log('[Telegram] parse-order failed:', JSON.stringify(result));
      return `❌ No pude interpretar el pedido. ${result.error || 'Intenta reformularlo.'}`;
    }

    console.log('[Telegram] parse-order items:', JSON.stringify(result.items.map((i: any) => ({
      matched: i.matched, productId: i.productId, productName: i.productName,
      requestedName: i.requestedName, suggestedName: i.suggestedName, customPrice: i.customPrice, quantity: i.quantity
    }))));
    console.log('[Telegram] Available products:', products.slice(0, 5).map(p => ({ id: p.id, nombre: p.nombre })));

    const presupuestoItems: any[] = [];
    let totalUSD = 0, totalBs = 0, totalUSDDivisa = 0;
    const pricingMode = result.pricingMode || mode || 'bcv';

    for (const item of result.items) {
      if (item.matched && item.productId) {
        let product = products.find(p => String(p.id) === item.productId);
        if (!product && item.productName) {
          const nameLower = item.productName.toLowerCase();
          product = products.find(p => p.nombre.toLowerCase() === nameLower) ||
                    products.find(p => p.nombre.toLowerCase().includes(nameLower) || nameLower.includes(p.nombre.toLowerCase()));
        }
        if (!product) {
          console.log(`[Telegram] Product not found: id=${item.productId}, name=${item.productName}`);
          continue;
        }

        const precioBCV = item.customPrice ?? product.precioUSD;
        const precioDivisa = item.customPriceDivisa ?? product.precioUSDDivisa ?? precioBCV;

        const precioMain = pricingMode === 'divisas' ? precioDivisa : precioBCV;
        const subtotalMain = precioMain * item.quantity;
        const subtotalDivisa = precioDivisa * item.quantity;

        presupuestoItems.push({
          nombre: product.nombre, cantidad: item.quantity, unidad: item.unit || product.unidad,
          precioUSD: precioMain, precioBs: precioMain * bcvRate.rate,
          subtotalUSD: subtotalMain, subtotalBs: subtotalMain * bcvRate.rate,
          precioUSDDivisa: pricingMode === 'dual' ? precioDivisa : precioMain,
          subtotalUSDDivisa: pricingMode === 'dual' ? subtotalDivisa : subtotalMain
        });

        totalUSD += subtotalMain;
        totalBs += subtotalMain * bcvRate.rate;
        totalUSDDivisa += subtotalDivisa;
      }
      else if (!item.matched && item.suggestedName && item.customPrice) {
        const precioBCV = item.customPrice;
        const precioDivisa = item.customPriceDivisa ?? precioBCV;

        const precioMain = pricingMode === 'divisas' ? precioDivisa : precioBCV;
        const subtotalMain = precioMain * item.quantity;
        const subtotalDivisa = precioDivisa * item.quantity;

        presupuestoItems.push({
          nombre: item.suggestedName, cantidad: item.quantity, unidad: item.unit || 'kg',
          precioUSD: precioMain, precioBs: precioMain * bcvRate.rate,
          subtotalUSD: subtotalMain, subtotalBs: subtotalMain * bcvRate.rate,
          precioUSDDivisa: pricingMode === 'dual' ? precioDivisa : precioMain,
          subtotalUSDDivisa: pricingMode === 'dual' ? subtotalDivisa : subtotalMain
        });

        totalUSD += subtotalMain;
        totalBs += subtotalMain * bcvRate.rate;
        totalUSDDivisa += subtotalDivisa;
      }
      else if (item.productName || item.requestedName) {
        const rawName = (item.productName || item.requestedName || '').toLowerCase();
        const cleanedName = rawName
          .replace(/^\d+(\.\d+)?\s*(kg|kilo|kilos|gr|g|cj|cajas?|paquetes?|unidades?|k|lb|libras?)\s*(de\s+)?/i, '')
          .replace(/\s+a\s+\$?\d+.*$/i, '')
          .trim();
        const searchName = cleanedName || rawName;
        console.log(`[Telegram] Name search: raw="${rawName}", cleaned="${cleanedName}", search="${searchName}"`);

        const product = products.find(p =>
          p.nombre.toLowerCase().includes(searchName) ||
          searchName.includes(p.nombre.toLowerCase())
        );

        if (product) {
          const precioBCV = item.customPrice ?? product.precioUSD;
          const precioDivisa = item.customPriceDivisa ?? product.precioUSDDivisa ?? precioBCV;
          const precioMain = pricingMode === 'divisas' ? precioDivisa : precioBCV;
          const subtotalMain = precioMain * item.quantity;
          const subtotalDivisa = precioDivisa * item.quantity;

          presupuestoItems.push({
            nombre: product.nombre, cantidad: item.quantity, unidad: item.unit || product.unidad,
            precioUSD: precioMain, precioBs: precioMain * bcvRate.rate,
            subtotalUSD: subtotalMain, subtotalBs: subtotalMain * bcvRate.rate,
            precioUSDDivisa: pricingMode === 'dual' ? precioDivisa : precioMain,
            subtotalUSDDivisa: pricingMode === 'dual' ? subtotalDivisa : subtotalMain
          });

          totalUSD += subtotalMain;
          totalBs += subtotalMain * bcvRate.rate;
          totalUSDDivisa += subtotalDivisa;
        } else {
          console.log(`[Telegram] Could not find product by name: ${searchName}`);
        }
      }
    }

    if (presupuestoItems.length === 0) {
      console.log('[Telegram] No valid items! Items received:', JSON.stringify(result.items));
      const itemSummary = result.items.map((i: any) =>
        `${i.productName || i.requestedName}: matched=${i.matched}, id=${i.productId}`
      ).join('; ');
      return `❌ No encontré productos válidos.\n\nRecibí: ${itemSummary || 'ningún item'}\n\nIntenta especificar el producto exacto.`;
    }

    if (result.delivery && result.delivery > 0) {
      totalUSD += result.delivery;
      totalUSDDivisa += result.delivery;
      totalBs += result.delivery * bcvRate.rate;
    }

    const id = String(Math.floor(10000 + Math.random() * 90000));
    const fechaPresupuesto = result.date ? `${result.date} 12:00:00` : null;
    const fechaSql = fechaPresupuesto ? `'${fechaPresupuesto}'` : `datetime('now', '-4 hours')`;

    await db.prepare(`
      INSERT INTO presupuestos (id, fecha, items, total_usd, total_bs, total_usd_divisa, modo_precio, delivery, hide_rate, estado, source, customer_name)
      VALUES (?, ${fechaSql}, ?, ?, ?, ?, ?, ?, ?, 'pendiente', 'telegram', ?)
    `).bind(
      id, JSON.stringify(presupuestoItems), totalUSD, totalBs,
      pricingMode !== 'bcv' ? totalUSDDivisa : null,
      pricingMode,
      result.delivery || 0,
      (hideRate || pricingMode === 'divisas') ? 1 : 0,
      result.customerName || null
    ).run();

    const shouldHideBs = hideRate || pricingMode === 'divisas';

    let responseText = `✅ *Presupuesto #${id}*\n`;
    if (result.customerName) responseText += `👤 ${result.customerName}\n`;
    if (result.date) responseText += `📅 Fecha: ${result.date}\n`;
    responseText += `📊 Modo: ${pricingMode.toUpperCase()}${shouldHideBs ? ' (sin Bs)' : ''}\n`;
    presupuestoItems.forEach(item => {
      responseText += `• ${item.nombre} x ${item.cantidad}: $${item.subtotalUSD.toFixed(2)}\n`;
    });
    if (result.delivery > 0) responseText += `• 🚗 Delivery: $${result.delivery.toFixed(2)}\n`;
    responseText += `\n*Total: $${totalUSD.toFixed(2)}*`;
    if (pricingMode === 'dual') responseText += ` / DIV: $${totalUSDDivisa.toFixed(2)}`;
    const adminUrl = await getAdminPresupuestoUrl(id, adminSecret, 'https://rpym.net');
    responseText += `\n🔗 ${adminUrl}`;

    if (result.customerName) {
      const linkResult = await linkBudgetToCustomer(db, id, result.customerName);
      if (linkResult.success) {
        responseText += `\n\n📋 Vinculado a cuenta de *${result.customerName}*`;
      }
    }

    return responseText;
  } catch (error) {
    console.error('[Telegram] Error creando presupuesto:', error);
    return `❌ Error: ${error}`;
  }
}

export async function createCustomerPurchaseWithProducts(
  db: D1Database | null,
  text: string,
  mode: string,
  baseUrl: string,
  apiKey: string,
  adminSecret: string,
  hideRate: boolean = false
): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';

  try {
    const bcvRate = await getBCVRate();
    const products = await getProducts(bcvRate.rate, db);
    const pricingMode = mode || 'bcv';

    const response = await fetch(`${baseUrl}/api/parse-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        products: products.map(p => ({
          id: String(p.id),
          nombre: p.nombre,
          unidad: p.unidad,
          precioUSD: p.precioUSD,
          precioUSDDivisa: p.precioUSDDivisa
        }))
      }),
    });

    const result = await response.json();
    console.log('[Telegram] parse-order result:', JSON.stringify(result).substring(0, 500));

    if (!result.success || !result.items?.length) {
      return `❌ ${result.error || 'No pude interpretar el pedido'}`;
    }

    let customer = null;
    if (result.customerName) {
      customer = await findCustomerByName(db, result.customerName);
    }

    if (!customer) {
      return `❌ No encontré cliente "${result.customerName || 'sin nombre'}". Créalo primero o especifica el nombre.`;
    }

    const presupuestoItems: any[] = [];
    let totalUSD = 0, totalBs = 0, totalUSDDivisa = 0;

    for (const item of result.items) {
      if (item.matched && item.productId) {
        const product = products.find(p => String(p.id) === item.productId);
        if (!product) continue;

        const precioUSD = item.customPrice ?? product.precioUSD;
        const precioUSDDivisa = item.customPriceDivisa ?? product.precioUSDDivisa ?? precioUSD;

        const precioMain = pricingMode === 'divisas' ? precioUSDDivisa : precioUSD;
        const subtotalMain = precioMain * item.quantity;
        const subtotalUSDDivisa = precioUSDDivisa * item.quantity;

        presupuestoItems.push({
          nombre: product.nombre,
          cantidad: item.quantity,
          unidad: item.unit || product.unidad,
          precioUSD: precioMain,
          precioBs: precioMain * bcvRate.rate,
          subtotalUSD: subtotalMain,
          subtotalBs: subtotalMain * bcvRate.rate,
          precioUSDDivisa,
          subtotalUSDDivisa
        });

        totalUSD += subtotalMain;
        totalBs += subtotalMain * bcvRate.rate;
        totalUSDDivisa += subtotalUSDDivisa;
      }
      else if (!item.matched && item.suggestedName && item.customPrice) {
        const precioUSD = item.customPrice;
        const precioUSDDivisa = item.customPriceDivisa ?? precioUSD;
        const precioMain = pricingMode === 'divisas' ? precioUSDDivisa : precioUSD;
        const subtotalMain = precioMain * item.quantity;
        const subtotalUSDDivisa = precioUSDDivisa * item.quantity;

        presupuestoItems.push({
          nombre: item.suggestedName,
          cantidad: item.quantity,
          unidad: item.unit || 'kg',
          precioUSD: precioMain,
          precioBs: precioMain * bcvRate.rate,
          subtotalUSD: subtotalMain,
          subtotalBs: subtotalMain * bcvRate.rate,
          precioUSDDivisa,
          subtotalUSDDivisa
        });

        totalUSD += subtotalMain;
        totalBs += subtotalMain * bcvRate.rate;
        totalUSDDivisa += subtotalUSDDivisa;
      }
    }

    if (presupuestoItems.length === 0) {
      return `❌ No encontré productos válidos en el pedido`;
    }

    const description = presupuestoItems.map(i => `${i.nombre} ${i.cantidad}${i.unidad}`).join(', ');

    const presupuestoId = String(Math.floor(10000 + Math.random() * 90000));
    const fechaPresupuesto = result.date ? `${result.date} 12:00:00` : null;
    const fechaSql = fechaPresupuesto ? `'${fechaPresupuesto}'` : `datetime('now', '-4 hours')`;

    await db.prepare(`
      INSERT INTO presupuestos (id, fecha, items, total_usd, total_bs, total_usd_divisa, modo_precio, delivery, hide_rate, estado, source, customer_name)
      VALUES (?, ${fechaSql}, ?, ?, ?, ?, ?, ?, ?, 'pendiente', 'telegram', ?)
    `).bind(
      presupuestoId,
      JSON.stringify(presupuestoItems),
      totalUSD,
      totalBs,
      pricingMode !== 'bcv' ? totalUSDDivisa : null,
      pricingMode,
      result.delivery || 0,
      (hideRate || pricingMode === 'divisas') ? 1 : 0,
      customer.name
    ).run();

    const currencyType = pricingMode === 'divisas' ? 'divisas' : 'dolar_bcv';

    await db.prepare(`
      INSERT INTO customer_transactions
      (customer_id, type, date, description, amount_usd, amount_bs, amount_usd_divisa, currency_type, presupuesto_id, exchange_rate, is_paid)
      VALUES (?, 'purchase', ${fechaSql}, ?, ?, ?, ?, ?, ?, ?, 0)
    `).bind(
      customer.id,
      description,
      totalUSD,
      totalBs,
      pricingMode === 'dual' ? totalUSDDivisa : null,
      currencyType,
      presupuestoId,
      bcvRate.rate
    ).run();

    const balanceQuery = currencyType === 'divisas'
      ? `SELECT COALESCE(SUM(CASE WHEN type='purchase' AND COALESCE(is_paid,0)=0 THEN amount_usd ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN type='payment' THEN amount_usd ELSE 0 END), 0) AS balance FROM customer_transactions WHERE customer_id = ? AND currency_type = 'divisas'`
      : `SELECT COALESCE(SUM(CASE WHEN type='purchase' AND COALESCE(is_paid,0)=0 THEN amount_usd ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN type='payment' THEN amount_usd ELSE 0 END), 0) AS balance FROM customer_transactions WHERE customer_id = ? AND currency_type = 'dolar_bcv'`;
    const balanceResult = await db.prepare(balanceQuery).bind(customer.id).first();
    const newBalance = Number(balanceResult?.balance || 0);

    const curr = currencyType === 'divisas' ? 'DIV' : 'BCV';
    let responseText = `🛒 *Compra registrada*\n\n`;
    responseText += `👤 ${customer.name}\n`;
    if (result.date) {
      responseText += `📅 Fecha: ${result.date}\n`;
    }
    responseText += `📋 Presupuesto #${presupuestoId}\n\n`;

    presupuestoItems.forEach((item: any) => {
      responseText += `• ${item.nombre} x ${item.cantidad}: $${item.subtotalUSD.toFixed(2)}`;
      if (pricingMode === 'dual') {
        responseText += ` / $${item.subtotalUSDDivisa.toFixed(2)}`;
      }
      responseText += '\n';
    });

    responseText += `\n💵 *Total: $${totalUSD.toFixed(2)}* (${curr})`;
    if (pricingMode === 'dual') {
      responseText += ` / DIV: $${totalUSDDivisa.toFixed(2)}`;
    }
    responseText += `\n💼 Balance ${curr}: $${newBalance.toFixed(2)}`;
    const adminUrl = await getAdminPresupuestoUrl(presupuestoId, adminSecret, 'https://rpym.net');
    responseText += `\n\n🔗 ${adminUrl}`;

    return responseText;
  } catch (error) {
    console.error('[Telegram] Error en createCustomerPurchaseWithProducts:', error);
    return `❌ Error: ${error}`;
  }
}
