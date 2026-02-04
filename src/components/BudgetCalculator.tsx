import { useState, useMemo } from 'react';
import type { Product, Category, BCVRate } from '../lib/sheets';
import { savePresupuesto, isConfigured } from '../lib/presupuesto-storage';
import ChefJose from './ChefJose';

interface Props {
  categories: Category[];
  bcvRate: BCVRate;
}

interface SelectedItem {
  product: Product;
  quantity: number;
}

// Tipos para el parsing con IA
interface ParsedItem {
  productId: string | null;
  productName: string | null;
  requestedName: string;
  quantity: number;
  unit: string;
  matched: boolean;
  confidence: 'high' | 'medium' | 'low';
}

interface ParseResponse {
  success: boolean;
  items: ParsedItem[];
  unmatched: string[];
  error?: string;
}

const categoryIcons: Record<string, string> = {
  'Camarones': '🦐',
  'Calamares': '🦑',
  'Mariscos': '🦀',
  'Especiales': '👑',
};

export default function BudgetCalculator({ categories, bcvRate }: Props) {
  const [selectedItems, setSelectedItems] = useState<Map<string, SelectedItem>>(new Map());
  const [isCartExpanded, setIsCartExpanded] = useState(false);
  const [showInlineSummary, setShowInlineSummary] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>(categories[0]?.name || '');
  // Estado para inputs que están siendo editados (evita que se cierre al borrar)
  const [editingInputs, setEditingInputs] = useState<Map<string, string>>(new Map());

  // Estados para el modo de pegar lista con IA
  const [inputMode, setInputMode] = useState<'manual' | 'paste' | 'chef'>('manual');
  const [pastedText, setPastedText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResponse | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [corrections, setCorrections] = useState(''); // Para aclaraciones del usuario

  // Estado para la nota de entrega
  const [showDeliveryNote, setShowDeliveryNote] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [presupuestoId, setPresupuestoId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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

  // Agregar rápidamente con cantidad mínima o cantidad específica
  const quickAdd = (product: Product, quantity?: number) => {
    if (quantity && quantity > 0) {
      updateQuantity(product, quantity);
    } else {
      const minQty = getMinQuantity(product);
      const current = selectedItems.get(product.id)?.quantity || 0;
      updateQuantity(product, current + (current === 0 ? minQty : product.incremento));
    }
  };

  // Obtener cantidad actual de un producto
  const getQuantity = (productId: string): number => {
    return selectedItems.get(productId)?.quantity || 0;
  };

  // Limpiar selección
  const clearSelection = () => {
    setSelectedItems(new Map());
    setIsCartExpanded(false);
    setPresupuestoId(null); // Resetear ID para nuevo presupuesto
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

  // Obtener todos los productos de todas las categorías
  const allProducts = useMemo(() => {
    return categories.flatMap(cat => cat.products);
  }, [categories]);

  // Procesar texto con IA
  const parseTextWithAI = async () => {
    if (!pastedText.trim()) return;

    setIsParsing(true);
    setParseError(null);
    setParseResult(null);

    try {
      const productInfo = allProducts.map(p => ({
        id: p.id,
        nombre: p.nombre,
        unidad: p.unidad,
        precioUSD: p.precioUSD
      }));

      const response = await fetch('/api/parse-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: pastedText,
          products: productInfo
        })
      });

      const result: ParseResponse = await response.json();

      if (result.success) {
        setParseResult(result);
      } else {
        setParseError(result.error || 'Error al procesar la lista');
      }
    } catch (error) {
      console.error('Error parseando:', error);
      setParseError('Error de conexión. Intenta de nuevo.');
    } finally {
      setIsParsing(false);
    }
  };

  // Aplicar productos parseados al presupuesto
  const applyParsedItems = () => {
    if (!parseResult) return;

    const newItems = new Map(selectedItems);

    parseResult.items.forEach(item => {
      if (item.matched && item.productId) {
        // Comparar IDs como strings para evitar problemas de tipo
        const product = allProducts.find(p => String(p.id) === String(item.productId));
        if (product) {
          const existingQty = newItems.get(product.id)?.quantity || 0;
          newItems.set(product.id, {
            product,
            quantity: existingQty + item.quantity
          });
        }
      }
    });

    setSelectedItems(newItems);
    // Limpiar y volver al modo manual
    setPastedText('');
    setParseResult(null);
    setInputMode('manual');
  };

  // Limpiar el parsing
  const clearParsing = () => {
    setPastedText('');
    setParseResult(null);
    setParseError(null);
    setCorrections('');
  };

  // Eliminar un item del resultado del parsing
  const removeParseItem = (indexToRemove: number) => {
    if (!parseResult) return;

    const updatedItems = parseResult.items.filter((_, index) => index !== indexToRemove);
    setParseResult({
      ...parseResult,
      items: updatedItems
    });
  };

  // Re-procesar con correcciones
  const reprocessWithCorrections = async () => {
    if (!corrections.trim()) return;

    // Combinar texto original con correcciones
    const combinedText = `${pastedText}\n\nACLARACIONES DEL CLIENTE:\n${corrections}`;

    setIsParsing(true);
    setParseError(null);
    setParseResult(null);

    try {
      const productInfo = allProducts.map(p => ({
        id: p.id,
        nombre: p.nombre,
        unidad: p.unidad,
        precioUSD: p.precioUSD
      }));

      const response = await fetch('/api/parse-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: combinedText,
          products: productInfo
        })
      });

      const result: ParseResponse = await response.json();

      if (result.success) {
        setParseResult(result);
        setCorrections(''); // Limpiar correcciones después de re-procesar
      } else {
        setParseError(result.error || 'Error al procesar la lista');
      }
    } catch (error) {
      console.error('Error parseando:', error);
      setParseError('Error de conexión. Intenta de nuevo.');
    } finally {
      setIsParsing(false);
    }
  };

  // Imprimir nota de entrega en ventana nueva
  const printDeliveryNote = () => {
    const content = document.getElementById('delivery-note-content');
    if (!content) return;

    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Presupuesto RPYM</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            padding: 0.5cm;
            background: white;
            color: #0c4a6e;
            font-size: 11px;
          }
          .border-2 { border: 1.5px solid #075985; }
          .border { border: 1px solid #7dd3fc; }
          .border-r { border-right: 1px solid #7dd3fc; }
          .border-r-2 { border-right: 1.5px solid #075985; }
          .border-b { border-bottom: 1px solid #7dd3fc; }
          .border-b-2 { border-bottom: 1.5px solid #075985; }
          .border-t-2 { border-top: 1.5px solid #075985; }
          .bg-ocean-100 { background: #e0f2fe; }
          .bg-ocean-50 { background: #f0f9ff; }
          .text-ocean-900 { color: #0c4a6e; }
          .text-ocean-700 { color: #0369a1; }
          .text-ocean-600 { color: #0284c7; }
          .text-ocean-500 { color: #0ea5e9; }
          .text-coral-600 { color: #ea580c; }
          .flex { display: flex; }
          .flex-1 { flex: 1; }
          .items-center { align-items: center; }
          .justify-between { justify-content: space-between; }
          .gap-3 { gap: 0.5rem; }
          .gap-4 { gap: 0.5rem; }
          .p-3 { padding: 0.4rem; }
          .p-4 { padding: 0.5rem; }
          .mb-2 { margin-bottom: 0.3rem; }
          .mb-4 { margin-bottom: 0.5rem; }
          .mt-6 { margin-top: 0.8rem; }
          .mt-8 { margin-top: 1rem; }
          .pt-2 { padding-top: 0.3rem; }
          .pt-4 { padding-top: 0.5rem; }
          .pb-1 { padding-bottom: 0.15rem; }
          .px-3 { padding-left: 0.4rem; padding-right: 0.4rem; }
          .py-1 { padding-top: 0.15rem; padding-bottom: 0.15rem; }
          .py-2 { padding-top: 0.3rem; padding-bottom: 0.3rem; }
          .mx-8 { margin-left: 1rem; margin-right: 1rem; }
          .w-12 { width: 2.5rem; }
          .h-12 { height: 2.5rem; }
          .w-48 { width: 9rem; }
          .w-20 { width: 4rem; }
          .w-24 { width: 5rem; }
          .rounded-full { border-radius: 9999px; }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .text-left { text-align: left; }
          .text-xl { font-size: 1rem; }
          .text-lg { font-size: 0.9rem; }
          .text-sm { font-size: 0.75rem; }
          .text-xs { font-size: 0.65rem; }
          .text-2xl { font-size: 1.1rem; }
          .font-bold { font-weight: 700; }
          .font-semibold { font-weight: 600; }
          .font-medium { font-weight: 500; }
          .font-mono { font-family: monospace; }
          .space-y-0\\.5 > * + * { margin-top: 0.1rem; }
          .space-y-2 > * + * { margin-top: 0.3rem; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 0.25rem 0.4rem; font-size: 0.7rem; }
          .grid { display: grid; }
          .grid-cols-2 { grid-template-columns: repeat(2, 1fr); }
          .col-span-2 { grid-column: span 2; }
          input { border: none; background: transparent; width: 100%; padding: 0.15rem 0; font-size: 0.75rem; }
          /* Estilos para aviso no fiscal */
          .bg-amber-50 { background: #fffbeb; }
          .border-amber-200 { border-color: #fde68a; }
          .text-amber-700 { color: #b45309; }
          .rounded { border-radius: 0.25rem; }
          .p-2 { padding: 0.3rem; }
          .mt-4 { margin-top: 0.5rem; }
          .mt-3 { margin-top: 0.4rem; }
          .pt-3 { padding-top: 0.4rem; }
          /* Ocultar filas vacías en impresión para ahorrar espacio */
          tr:has(td:first-child:empty) { display: none; }
          @media print {
            body { padding: 0; }
            @page { size: A4; margin: 0.5cm; }
          }
        </style>
      </head>
      <body>
        ${content.innerHTML}
      </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();

    // Esperar a que cargue y luego imprimir
    setTimeout(() => {
      printWindow.print();
    }, 250);
  };

  // Mostrar presupuesto y guardarlo automáticamente
  const handleShowDeliveryNote = async () => {
    // Mostrar el presupuesto inmediatamente
    setShowDeliveryNote(true);

    // Si ya se guardó este presupuesto, no volver a guardarlo
    if (presupuestoId) return;

    // Solo guardar si hay productos seleccionados y el módulo está configurado
    if (selectedItems.size === 0 || !isConfigured()) return;

    // Guardar en segundo plano (silencioso)
    setIsSaving(true);
    try {
      const items = Array.from(selectedItems.values()).map(({ product, quantity }) => ({
        nombre: product.nombre,
        cantidad: quantity,
        unidad: product.unidad,
        precioUSD: product.precioUSD,
        precioBs: product.precioBs,
        subtotalUSD: product.precioUSD * quantity,
        subtotalBs: product.precioBs * quantity
      }));

      const result = await savePresupuesto({
        items,
        totalUSD: totals.usd,
        totalBs: totals.bs,
        customerName,
        customerAddress,
        source: 'cliente',
      });

      if (result.success && result.id) {
        setPresupuestoId(result.id);
      }
    } catch (error) {
      // Silencioso - no mostrar errores al usuario
      console.error('Error guardando presupuesto:', error);
    } finally {
      setIsSaving(false);
    }
  };

  // Generar número de nota (usa el ID guardado si existe)
  const getDeliveryNoteNumber = () => {
    if (presupuestoId) {
      return presupuestoId;
    }
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  };

  // Obtener fecha actual formateada
  const getCurrentDate = () => {
    const now = new Date();
    return now.toLocaleDateString('es-VE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  return (
    <div className="space-y-4">
      {/* Header con tasa BCV - Sticky en móvil */}
      <div className="sticky top-0 z-40 bg-gradient-to-b from-ocean-50 via-ocean-50 to-transparent pt-2 pb-4 -mx-4 px-4">
        <div
          className={`flex items-center justify-between gap-3 bg-white rounded-2xl p-3 shadow-sm border border-ocean-100 ${selectedItems.size > 0 ? 'cursor-pointer hover:border-ocean-300 transition-colors' : ''}`}
          onClick={() => { if (selectedItems.size > 0) setShowInlineSummary(!showInlineSummary); }}
        >
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse"></span>
            <div>
              <span className="text-xs text-ocean-600 block leading-tight">Tasa BCV</span>
              <span className="text-base font-bold text-ocean-900">Bs. {bcvRate.rate.toFixed(2)}</span>
            </div>
          </div>
          {selectedItems.size > 0 && (
            <div className="flex items-center gap-2">
              <div className="text-right">
                <span className="text-xs text-ocean-600 block">{selectedItems.size} productos</span>
                <span className="text-lg font-bold text-coral-500">{formatUSD(totals.usd)}</span>
              </div>
              <svg className={`w-4 h-4 text-ocean-400 transition-transform ${showInlineSummary ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          )}
        </div>

        {/* Resumen desplegable del pedido */}
        {showInlineSummary && selectedItems.size > 0 && (
          <div className="mt-2 bg-white rounded-2xl border border-ocean-100 shadow-sm overflow-hidden">
            <div className="p-3 space-y-2 max-h-60 overflow-y-auto">
              {Array.from(selectedItems.values()).map(({ product, quantity }) => (
                <div key={product.id} className="flex items-center justify-between text-sm py-1.5 border-b border-ocean-50 last:border-0">
                  <span className="text-ocean-800 truncate flex-1 mr-2">{product.nombre}</span>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-ocean-600 text-xs">{formatQuantity(quantity)} {product.unidad}</span>
                    <span className="font-semibold text-coral-500 w-16 text-right">{formatUSD(product.precioUSD * quantity)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-ocean-100 p-3 bg-ocean-50/50 flex items-center justify-between">
              <div>
                <span className="text-sm font-bold text-coral-500">{formatUSD(totals.usd)}</span>
                <span className="text-xs text-ocean-600 ml-2">({formatBs(totals.bs)})</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); openWhatsApp(); }}
                className="px-4 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/>
                </svg>
                Pedir
              </button>
            </div>
          </div>
        )}

        {/* Tabs: Manual vs Pegar Lista */}
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setInputMode('manual')}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2
              ${inputMode === 'manual'
                ? 'bg-ocean-600 text-white shadow-md'
                : 'bg-white text-ocean-700 border border-ocean-200 hover:border-ocean-300'
              }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Seleccionar
          </button>
          <button
            onClick={() => setInputMode('paste')}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2
              ${inputMode === 'paste'
                ? 'bg-coral-500 text-white shadow-md'
                : 'bg-white text-ocean-700 border border-ocean-200 hover:border-ocean-300'
              }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Pegar Lista
          </button>
          <button
            onClick={() => setInputMode('chef')}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2
              ${inputMode === 'chef'
                ? 'bg-ocean-800 text-white shadow-md'
                : 'bg-white text-ocean-700 border border-ocean-200 hover:border-ocean-300'
              }`}
          >
            <img src="/camaronchef-sm.webp" alt="" className="w-5 h-5 rounded-full object-cover object-top" />
            Chef Jose
          </button>
        </div>

        {/* Navegación de categorías - Solo visible en modo manual */}
        {inputMode === 'manual' && (
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
        )}
      </div>

      {/* Sección de Pegar Lista con IA */}
      {inputMode === 'paste' && (
        <div className="bg-white rounded-2xl p-4 md:p-6 shadow-lg border border-coral-200">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 bg-coral-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <span className="text-xl">✨</span>
            </div>
            <div>
              <h3 className="font-semibold text-ocean-900">Pega tu lista</h3>
              <p className="text-sm text-ocean-600">
                Copia tu lista de WhatsApp y calculamos el presupuesto al instante
              </p>
            </div>
          </div>

          {!parseResult ? (
            <>
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder={`Ejemplo:
1kg jaiba
1/2kg camarones 41/50
500gr langostino
2 cajas camarón 61/70`}
                className="w-full h-40 p-4 border border-ocean-200 rounded-xl text-sm resize-none
                  focus:outline-none focus:ring-2 focus:ring-coral-500 focus:border-transparent
                  placeholder:text-ocean-400"
                disabled={isParsing}
              />

              {parseError && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-start gap-2">
                  <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {parseError}
                </div>
              )}

              <div className="mt-4 flex gap-3">
                <button
                  onClick={parseTextWithAI}
                  disabled={!pastedText.trim() || isParsing}
                  className="flex-1 py-3 bg-coral-500 hover:bg-coral-600 disabled:bg-ocean-200 disabled:cursor-not-allowed
                    text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {isParsing ? (
                    <>
                      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Calculando...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Calcular Presupuesto
                    </>
                  )}
                </button>
              </div>

              <p className="mt-3 text-xs text-ocean-500 text-center">
                Tip: Puedes copiar la lista directamente de WhatsApp
              </p>
            </>
          ) : (
            /* Resultado del parsing */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-ocean-900">Productos identificados</h4>
                <button
                  onClick={clearParsing}
                  className="text-sm text-ocean-600 hover:text-ocean-800"
                >
                  Editar lista
                </button>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {parseResult.items.map((item, index) => (
                  <div
                    key={index}
                    className={`p-3 rounded-xl border ${
                      item.matched
                        ? 'bg-green-50 border-green-200'
                        : 'bg-orange-50 border-orange-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          {item.matched ? (
                            <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                          )}
                          <span className="font-medium text-ocean-900 text-sm">
                            {item.matched ? item.productName : item.requestedName}
                          </span>
                        </div>
                        {item.matched && item.requestedName !== item.productName && (
                          <p className="text-xs text-ocean-500 mt-0.5 ml-6">
                            Pedido: "{item.requestedName}"
                          </p>
                        )}
                        {!item.matched && (
                          <p className="text-xs text-orange-700 mt-1 ml-6">
                            No encontrado en el catálogo
                          </p>
                        )}
                      </div>
                      <div className="flex items-start gap-2">
                        <div className="text-right">
                          <span className="text-sm font-semibold text-ocean-900">
                            {item.quantity} {item.unit}
                          </span>
                          {item.matched && item.productId && (
                            <span className="block text-xs text-coral-600 font-medium">
                              {formatUSD(
                                (allProducts.find(p => String(p.id) === String(item.productId))?.precioUSD || 0) * item.quantity
                              )}
                            </span>
                          )}
                        </div>
                        {/* Botón eliminar */}
                        <button
                          onClick={() => removeParseItem(index)}
                          className="flex-shrink-0 w-6 h-6 rounded-full bg-red-100 hover:bg-red-200 text-red-600
                            flex items-center justify-center transition-colors"
                          title="Eliminar este producto"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {parseResult.unmatched.length > 0 && (
                <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                  <p className="text-sm font-medium text-orange-800 mb-1">No se pudieron identificar:</p>
                  <p className="text-xs text-orange-700">{parseResult.unmatched.join(', ')}</p>
                </div>
              )}

              {/* Campo de correcciones/aclaraciones */}
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl">
                <div className="flex items-start gap-2 mb-2">
                  <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-blue-800">¿Algo no está bien?</p>
                    <p className="text-xs text-blue-600">
                      Escribe correcciones como: "el camarón es con concha, no pelado"
                    </p>
                  </div>
                </div>
                <textarea
                  value={corrections}
                  onChange={(e) => setCorrections(e.target.value)}
                  placeholder="Ej: el camarón 41/50 es con concha, no desvenado..."
                  className="w-full h-20 p-2 text-sm border border-blue-200 rounded-lg resize-none
                    focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent
                    placeholder:text-blue-400"
                />
                {corrections.trim() && (
                  <button
                    onClick={reprocessWithCorrections}
                    disabled={isParsing}
                    className="mt-2 w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-300
                      text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
                  >
                    {isParsing ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Recalculando...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Recalcular con correcciones
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Total estimado */}
              {parseResult.items.some(i => i.matched) && (
                <div className="p-4 bg-ocean-50 rounded-xl">
                  <div className="flex justify-between items-center">
                    <span className="text-ocean-700">Total estimado:</span>
                    <span className="text-2xl font-bold text-coral-500">
                      {formatUSD(
                        parseResult.items
                          .filter(i => i.matched && i.productId)
                          .reduce((sum, item) => {
                            const product = allProducts.find(p => String(p.id) === String(item.productId));
                            return sum + (product?.precioUSD || 0) * item.quantity;
                          }, 0)
                      )}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={clearParsing}
                  className="flex-1 py-3 border border-ocean-200 text-ocean-700 font-semibold rounded-xl
                    hover:bg-ocean-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={applyParsedItems}
                  disabled={!parseResult.items.some(i => i.matched)}
                  className="flex-1 py-3 bg-green-600 hover:bg-green-500 disabled:bg-ocean-200
                    text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Agregar al Presupuesto
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Chef José - Consulta culinaria */}
      {inputMode === 'chef' && (
        <ChefJose
          products={allProducts}
          selectedItems={selectedItems}
          onAddItem={quickAdd}
        />
      )}

      {/* Grid de productos - Solo en modo manual */}
      {inputMode === 'manual' && (
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

              {/* Micro-guía de tallas - solo para Camarones */}
              {category.name === 'Camarones' && (
                <div className="mb-3 bg-gradient-to-r from-ocean-100 to-coral-50 rounded-lg p-3 border border-ocean-200">
                  <p className="text-sm font-medium text-ocean-800 mb-2">
                    🦐 ¿No sabes qué camarón elegir?
                  </p>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <span className="inline-flex items-center gap-1 bg-white/80 px-2 py-1 rounded-full border border-ocean-200">
                      <span className="font-bold text-ocean-700">61/70</span>
                      <span className="text-ocean-600">Rendidor</span>
                    </span>
                    <span className="inline-flex items-center gap-1 bg-coral-100 px-2 py-1 rounded-full border border-coral-200">
                      <span className="font-bold text-coral-600">41/50</span>
                      <span className="text-coral-700">El más usado</span>
                      <span className="text-[10px]">⭐</span>
                    </span>
                    <span className="inline-flex items-center gap-1 bg-white/80 px-2 py-1 rounded-full border border-ocean-200">
                      <span className="font-bold text-ocean-700">36/40</span>
                      <span className="text-ocean-600">Grande</span>
                    </span>
                    <span className="inline-flex items-center gap-1 bg-white/80 px-2 py-1 rounded-full border border-ocean-200">
                      <span className="font-bold text-ocean-700">31/35</span>
                      <span className="text-ocean-600">Premium</span>
                    </span>
                  </div>
                  <p className="text-[10px] text-ocean-500 mt-1.5">
                    Menor número = camarón más grande
                  </p>
                </div>
              )}

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
                    onClick={handleShowDeliveryNote}
                    className="w-full mt-2 py-2.5 border border-ocean-200 text-ocean-700 hover:bg-ocean-50
                      rounded-xl transition-colors flex items-center justify-center gap-2 text-sm font-medium"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Ver Presupuesto
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
      )}

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

                <button
                  onClick={handleShowDeliveryNote}
                  className="w-full mt-2 py-3 border border-ocean-200 text-ocean-700 hover:bg-ocean-50
                    rounded-xl transition-colors flex items-center justify-center gap-2 text-sm font-medium"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Ver Presupuesto
                </button>

                <p className="text-xs text-ocean-600 mt-3 text-center">
                  Tasa BCV: Bs. {bcvRate.rate.toFixed(2)} / USD
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de Presupuesto */}
      {showDeliveryNote && (
        <div className="fixed inset-0 z-[100] overflow-auto print-container">
          {/* Overlay - se oculta al imprimir */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm no-print"
            onClick={() => setShowDeliveryNote(false)}
          />

          {/* Contenedor del modal */}
          <div className="min-h-screen flex items-center justify-center p-4 no-print-wrapper">
            <div className="relative bg-white w-full max-w-2xl rounded-lg shadow-2xl">
              {/* Botones de control - se ocultan al imprimir */}
              <div className="flex items-center justify-between p-4 border-b border-ocean-200 no-print">
                <h3 className="text-lg font-semibold text-ocean-900">Vista previa de Presupuesto</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={printDeliveryNote}
                    className="px-4 py-2 bg-ocean-600 hover:bg-ocean-700 text-white rounded-lg font-medium
                      flex items-center gap-2 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Imprimir
                  </button>
                  <button
                    onClick={() => setShowDeliveryNote(false)}
                    className="p-2 text-ocean-600 hover:text-ocean-800 hover:bg-ocean-50 rounded-lg transition-colors"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Contenido de la nota de entrega */}
              <div className="p-6 print:p-8" id="delivery-note-content">
                {/* Header de la nota */}
                <div className="border-2 border-ocean-800 mb-4">
                  <div className="flex">
                    {/* Logo y nombre del negocio */}
                    <div className="flex-1 p-4 border-r-2 border-ocean-800">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="flex-shrink-0 bg-white" style={{width:'48px',height:'48px',borderRadius:'50%',border:'2px solid #7dd3fc',overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center'}}>
                          <img src="/camaronlogo-sm.webp" alt="RPYM" style={{width:'67px',height:'67px',objectFit:'contain'}} />
                        </div>
                        <h1 className="text-xl font-bold text-ocean-900">RPYM</h1>
                      </div>
                      <div className="text-xs text-ocean-700 space-y-0.5">
                        <p><a href="https://www.google.com/maps/search/?api=1&query=Mercado+El+Mosquero%2C+Maiquet%C3%ADa" target="_blank" rel="noopener noreferrer" className="underline hover:text-ocean-900">Muelle Pesquero "El Mosquero"</a></p>
                        <p>Puesto 3 y 4, Maiquetía</p>
                        <p>WhatsApp: +58 414-214-5202</p>
                      </div>
                    </div>
                    {/* Nota de Entrega número y fecha */}
                    <div className="w-48 p-4 flex flex-col justify-between">
                      <div>
                        <h2 className="text-center font-bold text-ocean-900 text-lg border-b border-ocean-300 pb-1 mb-2">
                          PRESUPUESTO
                        </h2>
                        <p className="text-xs text-ocean-600">
                          Nº: <span className="font-mono font-medium text-ocean-900">{getDeliveryNoteNumber()}</span>
                        </p>
                      </div>
                      <p className="text-xs text-ocean-600">
                        Fecha: <span className="font-medium text-ocean-900">{getCurrentDate()}</span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Datos del cliente - Campos editables solo en pantalla */}
                <div className="border-2 border-ocean-800 mb-4 p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="text-xs font-medium text-ocean-600">Cliente:</label>
                      <input
                        type="text"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Nombre del cliente"
                        className="w-full border-b border-ocean-300 py-1 text-sm text-ocean-900
                          focus:outline-none focus:border-ocean-600 bg-transparent print:border-none"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs font-medium text-ocean-600">Dirección:</label>
                      <input
                        type="text"
                        value={customerAddress}
                        onChange={(e) => setCustomerAddress(e.target.value)}
                        placeholder="Dirección de entrega"
                        className="w-full border-b border-ocean-300 py-1 text-sm text-ocean-900
                          focus:outline-none focus:border-ocean-600 bg-transparent print:border-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Tabla de productos */}
                <div className="border-2 border-ocean-800 mb-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-ocean-100">
                        <th className="border-b-2 border-r border-ocean-800 px-3 py-2 text-left font-semibold text-ocean-900 w-20">
                          CANT.
                        </th>
                        <th className="border-b-2 border-r border-ocean-800 px-3 py-2 text-left font-semibold text-ocean-900">
                          CONCEPTO / REFERENCIA
                        </th>
                        <th className="border-b-2 border-r border-ocean-800 px-3 py-2 text-right font-semibold text-ocean-900 w-24">
                          PRECIO
                        </th>
                        <th className="border-b-2 border-ocean-800 px-3 py-2 text-right font-semibold text-ocean-900 w-24">
                          TOTAL
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(selectedItems.values()).map(({ product, quantity }, index) => (
                        <tr key={product.id} className={index % 2 === 0 ? 'bg-white' : 'bg-ocean-50/50'}>
                          <td className="border-r border-ocean-300 px-3 py-2 text-ocean-900">
                            {formatQuantity(quantity)} {product.unidad}
                          </td>
                          <td className="border-r border-ocean-300 px-3 py-2 text-ocean-900">
                            {product.nombre}
                          </td>
                          <td className="border-r border-ocean-300 px-3 py-2 text-right text-ocean-900">
                            {formatUSD(product.precioUSD)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-ocean-900">
                            {formatUSD(product.precioUSD * quantity)}
                          </td>
                        </tr>
                      ))}
                      {/* Filas vacías para completar la nota */}
                      {Array.from({ length: Math.max(0, 8 - selectedItems.size) }).map((_, i) => (
                        <tr key={`empty-${i}`} className={((selectedItems.size + i) % 2 === 0) ? 'bg-white' : 'bg-ocean-50/50'}>
                          <td className="border-r border-ocean-300 px-3 py-2">&nbsp;</td>
                          <td className="border-r border-ocean-300 px-3 py-2"></td>
                          <td className="border-r border-ocean-300 px-3 py-2"></td>
                          <td className="px-3 py-2"></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Totales */}
                <div className="border-2 border-ocean-800 mb-4">
                  <div className="flex">
                    <div className="flex-1 p-3 border-r-2 border-ocean-800">
                      <p className="text-xs font-medium text-ocean-600 mb-1">OBSERVACIONES:</p>
                      <p className="text-xs text-ocean-700">
                        Tasa BCV del día: Bs. {bcvRate.rate.toFixed(2)} por USD
                      </p>
                    </div>
                    <div className="w-48 p-3">
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-ocean-600">Total USD:</span>
                          <span className="font-bold text-ocean-900">{formatUSD(totals.usd)}</span>
                        </div>
                        <div className="flex justify-between text-sm border-t border-ocean-300 pt-2">
                          <span className="text-ocean-600">Total Bs.:</span>
                          <span className="font-bold text-coral-600">{formatBs(totals.bs)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Firmas */}
                <div className="grid grid-cols-2 gap-4 mt-8">
                  <div className="text-center">
                    <div className="border-t-2 border-ocean-800 pt-2 mx-8">
                      <p className="text-xs font-medium text-ocean-700">CONFORME CLIENTE</p>
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="border-t-2 border-ocean-800 pt-2 mx-8">
                      <p className="text-xs font-medium text-ocean-700">ENTREGADO POR</p>
                    </div>
                  </div>
                </div>

                {/* Aviso no fiscal */}
                <div className="mt-4 p-2 bg-amber-50 border border-amber-200 rounded text-center">
                  <p className="text-xs text-amber-700 font-medium">
                    Este documento no tiene validez fiscal - Solo para referencia
                  </p>
                </div>

                {/* Footer */}
                <div className="mt-3 pt-3 border-t border-ocean-200 text-center">
                  <p className="text-xs text-ocean-500">
                    www.rpym.net • WhatsApp: +58 414-214-5202
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
