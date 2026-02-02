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
  const [isCartExpanded, setIsCartExpanded] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>(categories[0]?.name || '');
  // Estado para inputs que están siendo editados (evita que se cierre al borrar)
  const [editingInputs, setEditingInputs] = useState<Map<string, string>>(new Map());

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

  // Agregar rápidamente con cantidad mínima
  const quickAdd = (product: Product) => {
    const minQty = getMinQuantity(product);
    const current = selectedItems.get(product.id)?.quantity || 0;
    updateQuantity(product, current + (current === 0 ? minQty : product.incremento));
  };

  // Obtener cantidad actual de un producto
  const getQuantity = (productId: string): number => {
    return selectedItems.get(productId)?.quantity || 0;
  };

  // Limpiar selección
  const clearSelection = () => {
    setSelectedItems(new Map());
    setIsCartExpanded(false);
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
    const formatted = qty.toFixed(3);
    return formatted.replace(/\.?0+$/, '');
  };

  // Obtener mínimo para un producto
  const getMinQuantity = (product: Product): number => {
    if (product.minimoKg) return product.minimoKg;
    if (product.incremento === 1) return 1;
    return 0.1;
  };

  // Manejar inicio de edición del input
  const handleInputFocus = (productId: string, currentQty: number) => {
    setEditingInputs(prev => {
      const next = new Map(prev);
      next.set(productId, formatQuantity(currentQty));
      return next;
    });
  };

  // Manejar cambio mientras se escribe
  const handleInputChange = (productId: string, value: string) => {
    setEditingInputs(prev => {
      const next = new Map(prev);
      next.set(productId, value);
      return next;
    });
  };

  // Manejar fin de edición (blur)
  const handleInputBlur = (product: Product) => {
    const editValue = editingInputs.get(product.id);
    const val = parseFloat(editValue || '0') || 0;
    const minQty = getMinQuantity(product);

    // Limpiar el estado de edición
    setEditingInputs(prev => {
      const next = new Map(prev);
      next.delete(product.id);
      return next;
    });

    // Actualizar cantidad
    if (val <= 0) {
      updateQuantity(product, 0);
    } else if (product.entradaLibre) {
      updateQuantity(product, val < minQty ? minQty : val);
    } else {
      const rounded = Math.round(val / product.incremento) * product.incremento;
      updateQuantity(product, rounded < minQty ? minQty : rounded);
    }
  };

  // Obtener valor a mostrar en el input
  const getInputValue = (productId: string, quantity: number): string => {
    // Si está siendo editado, mostrar el valor de edición
    if (editingInputs.has(productId)) {
      return editingInputs.get(productId) || '';
    }
    // Si no, mostrar la cantidad formateada
    return formatQuantity(quantity);
  };

  // Verificar si un producto está seleccionado o siendo editado
  const isProductActive = (productId: string, quantity: number): boolean => {
    return quantity > 0 || editingInputs.has(productId);
  };

  // Scroll a categoría
  const scrollToCategory = (categoryName: string) => {
    setActiveCategory(categoryName);
    const element = document.getElementById(`cat-${categoryName}`);
    if (element) {
      const offset = 120;
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - offset;
      window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
    }
  };

  return (
    <div className="space-y-4">
      {/* Header con tasa BCV - Sticky en móvil */}
      <div className="sticky top-0 z-40 bg-gradient-to-b from-ocean-50 via-ocean-50 to-transparent pt-2 pb-4 -mx-4 px-4">
        <div className="flex items-center justify-between gap-3 bg-white rounded-2xl p-3 shadow-sm border border-ocean-100">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse"></span>
            <div>
              <span className="text-xs text-ocean-600 block leading-tight">Tasa BCV</span>
              <span className="text-base font-bold text-ocean-900">Bs. {bcvRate.rate.toFixed(2)}</span>
            </div>
          </div>
          {selectedItems.size > 0 && (
            <div className="text-right">
              <span className="text-xs text-ocean-600 block">{selectedItems.size} productos</span>
              <span className="text-lg font-bold text-coral-500">{formatUSD(totals.usd)}</span>
            </div>
          )}
        </div>

        {/* Navegación de categorías - Scrollable horizontal */}
        <div className="mt-3 -mx-4 px-4">
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {categories.map((category) => (
              <button
                key={category.name}
                onClick={() => scrollToCategory(category.name)}
                className={`
                  flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all
                  ${activeCategory === category.name
                    ? 'bg-ocean-600 text-white shadow-md'
                    : 'bg-white text-ocean-700 border border-ocean-200'
                  }
                `}
              >
                <span className="mr-1.5">{categoryIcons[category.name] || '🐠'}</span>
                {category.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 md:gap-8">
        {/* Lista de productos */}
        <div className={`lg:col-span-2 space-y-6 ${selectedItems.size > 0 ? 'pb-44 lg:pb-0' : ''}`}>
          {categories.map((category) => (
            <div key={category.name} id={`cat-${category.name}`} className="scroll-mt-32">
              <h3 className="text-lg font-semibold text-ocean-800 mb-3 flex items-center gap-2 sticky top-28 bg-ocean-50/95 backdrop-blur-sm py-2 -mx-4 px-4 z-30">
                <span className="text-xl">{categoryIcons[category.name] || '🐠'}</span>
                {category.name}
                <span className="text-sm font-normal text-ocean-600">({category.products.length})</span>
              </h3>

              <div className="space-y-2">
                {category.products.filter(p => p.disponible).map((product) => {
                  const quantity = getQuantity(product.id);
                  const isSelected = isProductActive(product.id, quantity);

                  return (
                    <div
                      key={product.id}
                      className={`
                        bg-white rounded-xl p-3 transition-all border-2
                        ${isSelected
                          ? 'border-coral-400 shadow-md shadow-coral-100'
                          : 'border-transparent shadow-sm'
                        }
                      `}
                    >
                      <div className="flex items-start gap-3">
                        {/* Info del producto */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="font-medium text-ocean-900 text-sm">{product.nombre}</span>
                            {product.masVendido && (
                              <span className="bg-coral-100 text-coral-600 text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                                Popular
                              </span>
                            )}
                          </div>
                          {product.descripcionCorta && (
                            <p className="text-xs text-ocean-600 mb-1.5 line-clamp-1">{product.descripcionCorta}</p>
                          )}
                          <div className="flex items-baseline gap-2">
                            <span className="text-coral-500 font-bold text-base">{formatUSD(product.precioUSD)}</span>
                            <span className="text-ocean-600 text-xs">({formatBs(product.precioBs)})</span>
                            <span className="text-ocean-600 text-xs">/{product.unidad}</span>
                          </div>
                        </div>

                        {/* Controles de cantidad */}
                        <div className="flex-shrink-0">
                          {!isSelected ? (
                            // Botón de agregar rápido
                            <button
                              onClick={() => quickAdd(product)}
                              className="w-10 h-10 rounded-xl bg-coral-500 text-white font-bold text-xl
                                flex items-center justify-center active:scale-95 transition-transform
                                shadow-md shadow-coral-200"
                            >
                              +
                            </button>
                          ) : (
                            // Controles de cantidad
                            <div className="flex items-center gap-1 bg-ocean-50 rounded-xl p-1">
                              <button
                                onClick={() => {
                                  const minQty = getMinQuantity(product);
                                  const newQty = quantity - product.incremento;
                                  updateQuantity(product, newQty < minQty ? 0 : newQty);
                                }}
                                className="w-8 h-8 rounded-lg bg-white text-ocean-700 font-bold text-lg
                                  flex items-center justify-center active:bg-ocean-100 transition-colors shadow-sm"
                              >
                                −
                              </button>
                              <input
                                type="number"
                                value={getInputValue(product.id, quantity)}
                                onFocus={() => handleInputFocus(product.id, quantity)}
                                onChange={(e) => handleInputChange(product.id, e.target.value)}
                                onBlur={() => handleInputBlur(product)}
                                step={product.entradaLibre ? "0.001" : product.incremento}
                                min="0"
                                className="w-12 text-center bg-transparent text-ocean-900 font-medium text-sm
                                  focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                              <button
                                onClick={() => {
                                  const minQty = getMinQuantity(product);
                                  const newQty = quantity === 0 ? minQty : quantity + product.incremento;
                                  updateQuantity(product, newQty);
                                }}
                                className="w-8 h-8 rounded-lg bg-coral-500 text-white font-bold text-lg
                                  flex items-center justify-center active:bg-coral-600 transition-colors shadow-sm"
                              >
                                +
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Subtotal si hay cantidad real */}
                      {quantity > 0 && (
                        <div className="mt-2 pt-2 border-t border-ocean-100 flex items-center justify-between">
                          <span className="text-xs text-ocean-600">
                            {formatQuantity(quantity)} {product.unidad}
                          </span>
                          <span className="text-sm font-semibold text-coral-500">
                            {formatUSD(product.precioUSD * quantity)}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Resumen del presupuesto - Desktop */}
        <div className="hidden lg:block lg:col-span-1">
          <div className="bg-white rounded-2xl p-6 shadow-lg border border-ocean-200 sticky top-24">
            <h3 className="text-xl font-semibold text-ocean-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-coral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Tu Presupuesto
            </h3>

            {selectedItems.size === 0 ? (
              <div className="text-center py-8 text-ocean-600">
                <svg className="w-16 h-16 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
                <p className="text-sm">Toca el <span className="inline-flex items-center justify-center w-6 h-6 bg-coral-500 text-white rounded-lg text-xs font-bold">+</span> para agregar productos</p>
              </div>
            ) : (
              <>
                <div className="space-y-3 mb-6 max-h-80 overflow-y-auto">
                  {Array.from(selectedItems.values()).map(({ product, quantity }) => (
                    <div key={product.id} className="bg-ocean-50 rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className="text-ocean-800 text-sm font-medium leading-tight">{product.nombre}</span>
                        <button
                          onClick={() => updateQuantity(product, 0)}
                          className="flex-shrink-0 w-5 h-5 rounded-full bg-red-100 hover:bg-red-200 text-red-600
                            flex items-center justify-center transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-ocean-600 text-xs">{formatQuantity(quantity)} {product.unidad}</span>
                        <span className="font-semibold text-coral-500 text-sm">{formatUSD(product.precioUSD * quantity)}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-ocean-200 pt-4">
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-ocean-600">Total USD</span>
                      <span className="text-2xl font-bold text-coral-500">{formatUSD(totals.usd)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-ocean-600">Total Bs.</span>
                      <span className="text-lg font-semibold text-ocean-700">{formatBs(totals.bs)}</span>
                    </div>
                  </div>

                  <button
                    onClick={openWhatsApp}
                    className="w-full py-3.5 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-xl
                      transition-colors flex items-center justify-center gap-2 shadow-lg shadow-green-600/30"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
                    </svg>
                    Pedir por WhatsApp
                  </button>

                  <button
                    onClick={clearSelection}
                    className="w-full mt-2 py-2 text-ocean-600 hover:text-ocean-800 text-sm transition-colors"
                  >
                    Limpiar selección
                  </button>
                </div>
              </>
            )}

            <p className="text-xs text-ocean-600 mt-4 text-center">
              * Precios calculados con tasa BCV
            </p>
          </div>
        </div>
      </div>

      {/* Bottom Sheet móvil - Mejorado */}
      {selectedItems.size > 0 && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50">
          {/* Overlay para cerrar */}
          {isCartExpanded && (
            <div
              className="fixed inset-0 bg-black/30 backdrop-blur-sm"
              onClick={() => setIsCartExpanded(false)}
            />
          )}

          <div
            className={`
              relative bg-white rounded-t-3xl shadow-2xl border-t border-ocean-200
              transition-all duration-300 ease-out
              ${isCartExpanded ? 'max-h-[80vh]' : 'max-h-36'}
            `}
          >
            {/* Handle para arrastrar */}
            <button
              onClick={() => setIsCartExpanded(!isCartExpanded)}
              className="absolute top-0 left-0 right-0 flex justify-center py-3"
            >
              <div className="w-10 h-1 bg-ocean-300 rounded-full" />
            </button>

            {/* Contenido colapsado */}
            {!isCartExpanded && (
              <div className="pt-6 px-4 pb-4">
                <div className="flex items-center justify-between gap-3">
                  <button
                    onClick={() => setIsCartExpanded(true)}
                    className="flex-1 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-coral-100 rounded-xl flex items-center justify-center">
                        <span className="text-xl">🛒</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-ocean-900">{selectedItems.size} productos</p>
                        <p className="text-xl font-bold text-coral-500">{formatUSD(totals.usd)}</p>
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={openWhatsApp}
                    className="flex-shrink-0 h-14 px-6 bg-green-600 hover:bg-green-500 text-white font-semibold
                      rounded-2xl transition-colors flex items-center gap-2 shadow-lg shadow-green-600/30"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
                    </svg>
                    Pedir
                  </button>
                </div>
              </div>
            )}

            {/* Contenido expandido */}
            {isCartExpanded && (
              <div className="pt-8 px-4 pb-6 overflow-y-auto max-h-[calc(80vh-2rem)]">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-ocean-900">Tu Pedido</h3>
                  <button
                    onClick={clearSelection}
                    className="text-sm text-ocean-600 hover:text-ocean-800"
                  >
                    Limpiar todo
                  </button>
                </div>

                <div className="space-y-3 mb-6">
                  {Array.from(selectedItems.values()).map(({ product, quantity }) => (
                    <div key={product.id} className="bg-ocean-50 rounded-xl p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className="text-ocean-900 text-sm font-medium flex-1">{product.nombre}</span>
                        <button
                          onClick={() => updateQuantity(product, 0)}
                          className="w-6 h-6 rounded-full bg-red-100 text-red-600 flex items-center justify-center"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 bg-white rounded-lg p-1">
                          <button
                            onClick={() => {
                              const minQty = getMinQuantity(product);
                              const newQty = quantity - product.incremento;
                              updateQuantity(product, newQty < minQty ? 0 : newQty);
                            }}
                            className="w-7 h-7 rounded-md bg-ocean-100 text-ocean-700 font-bold flex items-center justify-center"
                          >
                            −
                          </button>
                          <span className="w-12 text-center text-sm font-medium text-ocean-900">
                            {formatQuantity(quantity)}
                          </span>
                          <button
                            onClick={() => updateQuantity(product, quantity + product.incremento)}
                            className="w-7 h-7 rounded-md bg-coral-500 text-white font-bold flex items-center justify-center"
                          >
                            +
                          </button>
                          <span className="text-ocean-600 text-xs ml-1">{product.unidad}</span>
                        </div>
                        <span className="font-bold text-coral-500">{formatUSD(product.precioUSD * quantity)}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Totales */}
                <div className="border-t border-ocean-200 pt-4 mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-ocean-600">Total USD</span>
                    <span className="text-2xl font-bold text-coral-500">{formatUSD(totals.usd)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-ocean-600">Total Bs.</span>
                    <span className="text-lg font-semibold text-ocean-700">{formatBs(totals.bs)}</span>
                  </div>
                </div>

                <button
                  onClick={openWhatsApp}
                  className="w-full py-4 bg-green-600 hover:bg-green-500 text-white font-semibold text-lg
                    rounded-2xl transition-colors flex items-center justify-center gap-2 shadow-lg shadow-green-600/30"
                >
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
                  </svg>
                  Enviar Pedido por WhatsApp
                </button>

                <p className="text-xs text-ocean-600 mt-3 text-center">
                  Tasa BCV: Bs. {bcvRate.rate.toFixed(2)} / USD
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
