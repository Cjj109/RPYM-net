/**
 * Utilidades de lógica de negocio para presupuestos RPYM
 */

interface ModoPrecioInput {
  modoPrecio?: string;
  totalUSDDivisa?: number;
  totalBs?: number;
  totalUSD?: number;
  hideRate?: boolean;
}

/**
 * Infiere el modo de precio para presupuestos legacy que no tienen modoPrecio guardado.
 * Retorna el modoPrecio existente si está presente, o lo infiere de los totales.
 */
export function inferModoPrecio(data: ModoPrecioInput): 'bcv' | 'divisa' | 'dual' {
  if (data.modoPrecio === 'bcv' || data.modoPrecio === 'divisa' || data.modoPrecio === 'dual') {
    return data.modoPrecio;
  }

  // Legacy inference
  if (
    data.totalUSDDivisa &&
    data.totalBs &&
    data.totalBs > 0 &&
    data.totalUSDDivisa !== data.totalUSD
  ) {
    return 'dual';
  }

  if (data.totalBs === 0) {
    return 'divisa';
  }

  return 'bcv';
}
