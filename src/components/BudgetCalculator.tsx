import { useState, useMemo } from 'react';
import type { Product, Category, BCVRate } from '../lib/sheets';

interface Props {
  categories: Category[];
  bcvRate: BCVRate;
}

interface SelectedItem {
  product: Product;
  quantity: number;
}

const categoryIcons: Record<string, string> = {
  'Camarones': '🦐',
  'Mariscos': '🦑',
  'Especiales': '👑',
};

export default function BudgetCalculator({ categories, bcvRate }: Props) {
  const [selectedItems, setSelectedItems] = useState<Map<string, SelectedItem>>(new Map());

  // Calcular totales
  const totals = useMemo(() => {
    let usd = 0;
    let bs = 0;
    selectedItems.forEach(item => {
      usd += item.product.precioUSD * item.quantity;
      bs += item.product.precioBs * item.quantity;
    });
    return { usd, bs };
  }, [selectedItems]);

  // Actualizar cantidad de un producto
  const updateQuantity = (product: Product, quantity: number) => {
    setSelectedItems(prev => {
      const next = new Map(prev);
      if (quantity <= 0) {
        next.delete(product.id);
      } else {
        next.set(product.id, { product, quantity });
      }
      return next;
    });
  };

  // Obtener cantidad actual de un producto
  const getQuantity = (productId: string): number => {
    return selectedItems.get(productId)?.quantity || 0;
  };

  // Limpiar selección
  const clearSelection = () => {
    setSelectedItems(new Map());
  };

  // Generar mensaje de WhatsApp con el pedido detallado
  const generateWhatsAppMessage = (): string => {
    if (selectedItems.size === 0) return '';

    let message = '¡Hola! Quisiera hacer el siguiente pedido:\n\n';

    selectedItems.forEach(({ product, quantity }) => {
      const formattedQty = formatQuantity(quantity);
      const subtotal = product.precioUSD * quantity;
      message += `• ${product.nombre}: ${formattedQty} ${product.unidad} ($${subtotal.toFixed(2)})\n`;
    });

    message += `\n─────────────────\n`;
    message += `*TOTAL: ${formatUSD(totals.usd)}*\n`;
    message += `(Bs. ${totals.bs.toFixed(2)} a tasa BCV)\n\n`;
    message += `¿Está disponible? Gracias.`;

    return encodeURIComponent(message);
  };

  // Abrir WhatsApp con el pedido
  const openWhatsApp = () => {
    const message = generateWhatsAppMessage();
    if (message) {
      window.open(`https://wa.me/584142145202?text=${message}`, '_blank');
    }
  };

  // Formatear precios
  const formatUSD = (price: number) => `$${price.toFixed(2)}`;
  const formatBs = (price: number) => `Bs. ${price.toFixed(2)}`;

  // Formatear cantidad sin ceros innecesarios
  const formatQuantity = (qty: number): string => {
    if (qty === 0) return '';
    // Mostrar hasta 3 decimales pero sin ceros al final
    const formatted = qty.toFixed(3);
    return formatted.replace(/\.?0+$/, '');
  };

  // Obtener mínimo para un producto
  const getMinQuantity = (product: Product): number => {
    if (product.minimoKg) return product.minimoKg;
    if (product.incremento === 1) return 1; // Productos por unidad
    return 0.1; // Mínimo para productos por kg
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Indicador de tasa BCV */}
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-2 md:gap-3 bg-white border border-ocean-200 rounded-full px-3 py-2 md:px-5 md:py-2.5 shadow-sm">
          <div className="flex items-center gap-1.5 md:gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
            <span className="text-xs md:text-sm font-medium text-ocean-700">Tasa BCV</span>
          </div>
          <div className="h-4 w-px bg-ocean-200"></div>
          <span className="text-base md:text-lg font-bold text-ocean-900">
            Bs. {bcvRate.rate.toFixed(2)}
          </span>
          <span className="text-[10px] md:text-xs text-ocean-500">
            / USD
          </span>
        </div>
      </div>

      {/* Resumen flotante en móvil */}
      {selectedItems.size > 0 && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-ocean-200 p-4 shadow-lg z-50">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-shrink-0">
              <p className="text-xs text-ocean-600">{selectedItems.size} producto(s)</p>
              <p className="text-lg font-bold text-coral-500">{formatUSD(totals.usd)}</p>
              <p className="text-xs text-ocean-500">{formatBs(totals.bs)}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={clearSelection}
                className="px-3 py-2 text-sm text-ocean-600 border border-ocean-300 rounded-full hover:bg-ocean-50 transition-colors"
              >
                Limpiar
              </button>
              <button
                onClick={openWhatsApp}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded-full transition-colors"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
                </svg>
                Pedir
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4 md:gap-8">
        {/* Lista de productos */}
        <div className={`lg:col-span-2 space-y-4 md:space-y-6 ${selectedItems.size > 0 ? 'pb-28 lg:pb-0' : ''}`}>
          {categories.map((category) => (
            <div key={category.name} className="bg-white rounded-xl md:rounded-2xl p-4 md:p-6 shadow-sm border border-ocean-100">
              <h3 className="text-lg md:text-xl font-semibold text-ocean-800 mb-3 md:mb-4 flex items-center gap-2">
                <span>{categoryIcons[category.name] || '🐠'}</span>
                {category.name}
              </h3>

              <div className="space-y-2 md:space-y-3">
                {category.products.filter(p => p.disponible).map((product) => {
                  const quantity = getQuantity(product.id);
                  const isSelected = quantity > 0;

                  return (
                    <div
                      key={product.id}
                      className={`
                        flex items-center justify-between p-2.5 md:p-3 rounded-lg md:rounded-xl transition-all
                        ${isSelected
                          ? 'bg-ocean-50 border-2 border-ocean-300'
                          : 'bg-ocean-50/50 border-2 border-transparent'
                        }
                      `}
                    >
                      <div className="flex-1 min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-ocean-900 text-sm md:text-base block truncate">{product.nombre}</span>
                          {product.masVendido && (
                            <svg className="w-3.5 h-3.5 text-coral-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                            </svg>
                          )}
                        </div>
                        {product.descripcionCorta && (
                          <p className="text-[10px] md:text-xs text-ocean-500 mt-0.5 line-clamp-1">
                            {product.descripcionCorta}
                          </p>
                        )}
                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                          <span className="text-coral-500 font-semibold text-xs md:text-sm">
                            {formatUSD(product.precioUSD)}
                          </span>
                          <span className="text-ocean-400 text-xs">
                            ({formatBs(product.precioBs)})
                          </span>
                          <span className="text-ocean-400 text-[10px] md:text-xs">
                            /{product.unidad}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 md:gap-2">
                        <button
                          onClick={() => {
                            const minQty = getMinQuantity(product);
                            const newQty = quantity - product.incremento;
                            updateQuantity(product, newQty < minQty ? 0 : newQty);
                          }}
                          disabled={quantity <= 0}
                          className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-ocean-200 text-ocean-700 font-bold
                            active:bg-ocean-300 disabled:opacity-40 disabled:cursor-not-allowed
                            transition-colors flex items-center justify-center text-sm md:text-base"
                          aria-label="Reducir cantidad"
                        >
                          −
                        </button>

                        <input
                          type="number"
                          value={formatQuantity(quantity)}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            const minQty = getMinQuantity(product);

                            if (product.entradaLibre) {
                              // Entrada libre: aceptar cualquier valor >= mínimo
                              if (val > 0 && val < minQty) {
                                updateQuantity(product, minQty);
                              } else {
                                updateQuantity(product, val);
                              }
                            } else {
                              // Redondear al incremento más cercano
                              const rounded = Math.round(val / product.incremento) * product.incremento;
                              if (rounded > 0 && rounded < minQty) {
                                updateQuantity(product, minQty);
                              } else {
                                updateQuantity(product, rounded);
                              }
                            }
                          }}
                          placeholder="0"
                          step={product.entradaLibre ? "0.001" : product.incremento}
                          min="0"
                          className="w-14 md:w-20 text-center border border-ocean-200 rounded-lg py-1 text-sm md:text-base
                            focus:outline-none focus:ring-2 focus:ring-ocean-400 text-ocean-900"
                        />

                        <button
                          onClick={() => {
                            const minQty = getMinQuantity(product);
                            const newQty = quantity === 0 ? minQty : quantity + product.incremento;
                            updateQuantity(product, newQty);
                          }}
                          className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-coral-500 text-white font-bold
                            active:bg-coral-600 transition-colors flex items-center justify-center text-sm md:text-base"
                          aria-label="Aumentar cantidad"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Resumen del presupuesto - Solo visible en desktop */}
        <div className="hidden lg:block lg:col-span-1">
          <div className="bg-white rounded-2xl p-6 shadow-lg border border-ocean-200 sticky top-24">
            <h3 className="text-xl font-semibold text-ocean-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-coral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Tu Presupuesto
            </h3>

            {selectedItems.size === 0 ? (
              <div className="text-center py-8 text-ocean-500">
                <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
                <p>Selecciona productos para<br/>calcular tu presupuesto</p>
              </div>
            ) : (
              <>
                <div className="space-y-3 mb-6 max-h-80 overflow-y-auto">
                  {Array.from(selectedItems.values()).map(({ product, quantity }) => (
                    <div key={product.id} className="bg-ocean-50 rounded-lg p-2.5">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className="text-ocean-800 text-sm font-medium leading-tight">{product.nombre}</span>
                        <button
                          onClick={() => updateQuantity(product, 0)}
                          className="flex-shrink-0 w-5 h-5 rounded-full bg-red-100 hover:bg-red-200 text-red-600
                            flex items-center justify-center transition-colors"
                          aria-label="Eliminar producto"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              const minQty = getMinQuantity(product);
                              const newQty = quantity - product.incremento;
                              updateQuantity(product, newQty < minQty ? 0 : newQty);
                            }}
                            className="w-6 h-6 rounded-full bg-ocean-200 text-ocean-700 text-xs font-bold
                              hover:bg-ocean-300 transition-colors flex items-center justify-center"
                          >
                            −
                          </button>
                          <input
                            type="number"
                            value={formatQuantity(quantity)}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              const minQty = getMinQuantity(product);
                              if (product.entradaLibre) {
                                if (val > 0 && val < minQty) {
                                  updateQuantity(product, minQty);
                                } else {
                                  updateQuantity(product, val);
                                }
                              } else {
                                const rounded = Math.round(val / product.incremento) * product.incremento;
                                if (rounded > 0 && rounded < minQty) {
                                  updateQuantity(product, minQty);
                                } else {
                                  updateQuantity(product, rounded);
                                }
                              }
                            }}
                            step={product.entradaLibre ? "0.001" : product.incremento}
                            min="0"
                            className="w-14 text-center border border-ocean-200 rounded py-0.5 text-xs
                              focus:outline-none focus:ring-1 focus:ring-ocean-400 text-ocean-900"
                          />
                          <button
                            onClick={() => updateQuantity(product, quantity + product.incremento)}
                            className="w-6 h-6 rounded-full bg-coral-500 text-white text-xs font-bold
                              hover:bg-coral-600 transition-colors flex items-center justify-center"
                          >
                            +
                          </button>
                          <span className="text-ocean-500 text-xs ml-1">{product.unidad}</span>
                        </div>
                        <div className="text-right">
                          <span className="font-semibold text-coral-500 text-sm block">
                            {formatUSD(product.precioUSD * quantity)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-ocean-200 pt-4">
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-ocean-600">Total USD</span>
                      <span className="text-xl font-bold text-coral-500">
                        {formatUSD(totals.usd)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-ocean-600">Total Bs.</span>
                      <span className="text-lg font-semibold text-ocean-700">
                        {formatBs(totals.bs)}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={openWhatsApp}
                    className="w-full py-3 bg-green-600 hover:bg-green-500 text-white font-medium rounded-xl
                      transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
                    </svg>
                    Pedir por WhatsApp
                  </button>

                  <button
                    onClick={clearSelection}
                    className="w-full py-2 text-ocean-600 hover:text-ocean-800 text-sm
                      transition-colors underline underline-offset-2"
                  >
                    Limpiar selección
                  </button>
                </div>
              </>
            )}

            <p className="text-xs text-ocean-500 mt-4 text-center">
              * Precios calculados con tasa BCV. Confirma en el local.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
