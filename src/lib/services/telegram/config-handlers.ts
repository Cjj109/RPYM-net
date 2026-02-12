/**
 * RPYM - Telegram handlers para configuración (stats, tema, BCV)
 */

import type { D1Database } from '../../d1-types';
import { getBCVRate } from '../../sheets';

export async function getStats(db: D1Database | null): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const today = new Date().toISOString().split('T')[0];
    const todayStats = await db.prepare(`
      SELECT COUNT(*) as total, SUM(CASE WHEN estado = 'pagado' THEN 1 ELSE 0 END) as pagados,
             SUM(CASE WHEN estado = 'pagado' THEN total_usd ELSE 0 END) as vendido
      FROM presupuestos WHERE date(fecha) = ?
    `).bind(today).first<{ total: number; pagados: number; vendido: number }>();
    const bcvRate = await getBCVRate(db);
    let text = `📊 *Estadísticas Hoy*\n\n`;
    text += `• Presupuestos: ${todayStats?.total || 0}\n`;
    text += `• Pagados: ${todayStats?.pagados || 0}\n`;
    text += `• Vendido: $${(todayStats?.vendido || 0).toFixed(2)}\n`;
    text += `\n💱 Tasa: Bs. ${bcvRate.rate.toFixed(2)}`;
    return text;
  } catch (error) {
    return '❌ Error al obtener estadísticas';
  }
}

export async function changeTheme(db: D1Database | null, theme: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  const themeMap: Record<string, string> = {
    'normal': 'ocean', 'ocean': 'ocean', 'navidad': 'christmas', 'navideno': 'christmas',
    'navideño': 'christmas', 'christmas': 'christmas', 'carnaval': 'carnival', 'carnival': 'carnival',
    'sanvalentin': 'valentine', 'san valentin': 'valentine', 'valentine': 'valentine',
    'pascua': 'easter', 'easter': 'easter', 'mundial': 'mundial', 'halloween': 'halloween',
  };
  const themeLower = theme.toLowerCase().replace(/\s+/g, '');
  const mappedTheme = themeMap[themeLower];
  if (!mappedTheme) return `❌ Tema no válido. Opciones: normal, navidad, carnaval, sanvalentin, pascua, mundial, halloween`;
  try {
    await db.prepare("INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES ('theme', ?, datetime('now', '-4 hours'))").bind(mappedTheme).run();
    const emojis: Record<string, string> = { ocean: '🦐', christmas: '🎄', carnival: '🎭', valentine: '❤️', easter: '🐰', mundial: '⚽', halloween: '🎃' };
    const names: Record<string, string> = { ocean: 'NORMAL', christmas: 'NAVIDAD', carnival: 'CARNAVAL', valentine: 'SAN VALENTÍN', easter: 'PASCUA', mundial: 'MUNDIAL', halloween: 'HALLOWEEN' };
    return `${emojis[mappedTheme]} Tema cambiado a *${names[mappedTheme]}*`;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}
