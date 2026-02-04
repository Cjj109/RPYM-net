import { useState, useMemo, useEffect } from 'react';
import type { Product, Category, BCVRate } from '../lib/sheets';
import { savePresupuesto, updatePresupuesto, type Presupuesto } from '../lib/presupuesto-storage';

interface Props {
  categories: Category[];
  bcvRate: BCVRate;
  editingPresupuesto?: Presupuesto | null;
  onEditComplete?: () => void;
}

interface AdminSelectedItem {
  product: Product;
  quantity: number;
  customPrice: number | null; // null = use default price
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

export default function AdminBudgetBuilder({ categories, bcvRate, editingPresupuesto, onEditComplete }: Props) {
  // Product selection state
  const [selectedItems, setSelectedItems] = useState<Map<string, AdminSelectedItem>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>(categories[0]?.name || '');

  // Customer info
  const [customerName, setCustomerName] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');

  // Delivery cost
  const [deliveryCost, setDeliveryCost] = useState(0);

  // AI paste mode
  const [inputMode, setInputMode] = useState<'manual' | 'paste'>('manual');
  const [pastedText, setPastedText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResponse | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [corrections, setCorrections] = useState('');

  // Editing quantity inputs
  const [editingInputs, setEditingInputs] = useState<Map<string, string>>(new Map());

  // Editing price inputs (string-based to allow clearing)
  const [editingPrices, setEditingPrices] = useState<Map<string, string>>(new Map());

  // Editing delivery input (string-based to allow clearing)
  const [editingDelivery, setEditingDelivery] = useState<string | null>(null);

  // Solo divisas mode (hide Bs)
  const [soloDivisas, setSoloDivisas] = useState(false);

  // Mark as paid toggle
  const [markAsPaid, setMarkAsPaid] = useState(false);

  // Custom product form
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customUnit, setCustomUnit] = useState('kg');
  const [customPriceUSD, setCustomPriceUSD] = useState('');

  // Dollar input mode
  const [dollarInputMode, setDollarInputMode] = useState<Set<string>>(new Set());
  const [dollarInputValues, setDollarInputValues] = useState<Map<string, string>>(new Map());

  // Editing prices in summary panel
  const [editingSummaryPrices, setEditingSummaryPrices] = useState<Map<string, string>>(new Map());

  // Save state
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [presupuestoId, setPresupuestoId] = useState<string | null>(null);

  // All products flattened
  const allProducts = useMemo(() => {
    return categories.flatMap(cat => cat.products);
  }, [categories]);

  // Load editing presupuesto data
  useEffect(() => {
    if (!editingPresupuesto) return;

    const newItems = new Map<string, AdminSelectedItem>();

    for (const item of editingPresupuesto.items) {
      // Try to find product in catalog by name
      const normalizedItemName = item.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const catalogProduct = allProducts.find(p =>
        p.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === normalizedItemName
      );

      if (catalogProduct) {
        const isCustomPrice = Math.abs(catalogProduct.precioUSD - item.precioUSD) > 0.01;
        newItems.set(catalogProduct.id, {
          product: catalogProduct,
          quantity: item.cantidad,
          customPrice: isCustomPrice ? item.precioUSD : null,
        });
      } else {
        // Create custom product for items not in catalog
        const customId = `custom-edit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const customProduct: Product = {
          id: customId,
          nombre: item.nombre,
          precioUSD: item.precioUSD,
          unidad: item.unidad,
          descripcionCorta: 'Producto personalizado',
          disponible: true,
          esCaja: false,
          incremento: item.unidad === 'kg' ? 0.5 : 1,
          minimoKg: item.unidad === 'kg' ? 0.5 : 1,
        };
        newItems.set(customId, {
          product: customProduct,
          quantity: item.cantidad,
          customPrice: null,
        });
      }
    }

    setSelectedItems(newItems);
    setPresupuestoId(editingPresupuesto.id);
    setCustomerName(editingPresupuesto.customerName || '');
    setCustomerAddress(editingPresupuesto.customerAddress || '');
    if (editingPresupuesto.estado === 'pagado') setMarkAsPaid(true);
  }, [editingPresupuesto]);

  // Normalize text for accent-insensitive search
  const normalize = (text: string) =>
    text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Filtered products based on search
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return categories;
    const query = normalize(searchQuery);
    return categories
      .map(cat => ({
        ...cat,
        products: cat.products.filter(p =>
          normalize(p.nombre).includes(query) ||
          normalize(p.descripcionCorta || '').includes(query)
        ),
      }))
      .filter(cat => cat.products.length > 0);
  }, [categories, searchQuery]);

  // Get effective price for an item
  const getEffectivePrice = (item: AdminSelectedItem): number => {
    return item.customPrice !== null ? item.customPrice : item.product.precioUSD;
  };

  // Calculate totals
  const totals = useMemo(() => {
    let usd = 0;
    selectedItems.forEach(item => {
      // Round each item subtotal to 2 decimals to avoid floating point accumulation
      usd += Math.round(getEffectivePrice(item) * item.quantity * 100) / 100;
    });
    const usdWithDelivery = Math.round((usd + deliveryCost) * 100) / 100;
    return {
      subtotalUSD: usd,
      deliveryUSD: deliveryCost,
      totalUSD: usdWithDelivery,
      totalBs: Math.round(usdWithDelivery * bcvRate.rate * 100) / 100,
    };
  }, [selectedItems, deliveryCost, bcvRate.rate]);

  // Format helpers
  const formatUSD = (price: number) => `$${price.toFixed(2)}`;
  const formatBs = (price: number) => `Bs. ${price.toFixed(2)}`;
  const formatQuantity = (qty: number): string => {
    if (qty === 0) return '';
    const formatted = qty.toFixed(3);
    return formatted.replace(/\.?0+$/, '');
  };

  const getMinQuantity = (product: Product): number => {
    if (product.minimoKg) return product.minimoKg;
    if (product.incremento === 1) return 1;
    return 0.1;
  };

  // Update quantity for a product
  const updateQuantity = (product: Product, quantity: number) => {
    setSelectedItems(prev => {
      const next = new Map(prev);
      if (quantity <= 0) {
        next.delete(product.id);
      } else {
        const existing = prev.get(product.id);
        next.set(product.id, {
          product,
          quantity,
          customPrice: existing?.customPrice ?? null,
        });
      }
      return next;
    });
  };

  // Update custom price for a product
  const updateCustomPrice = (productId: string, price: number | null) => {
    setSelectedItems(prev => {
      const next = new Map(prev);
      const existing = prev.get(productId);
      if (existing) {
        next.set(productId, { ...existing, customPrice: price });
      }
      return next;
    });
  };

  // Quick add product
  const quickAdd = (product: Product) => {
    const minQty = getMinQuantity(product);
    const current = selectedItems.get(product.id)?.quantity || 0;
    updateQuantity(product, current + (current === 0 ? minQty : product.incremento));
  };

  const getQuantity = (productId: string): number => {
    return selectedItems.get(productId)?.quantity || 0;
  };

  const clearSelection = () => {
    setSelectedItems(new Map());
    setPresupuestoId(null);
    setSaveMessage(null);
  };

  // Add custom product
  const addCustomProduct = () => {
    const name = customName.trim();
    const price = parseFloat(customPriceUSD);
    if (!name || isNaN(price) || price <= 0) return;

    const customProduct: Product = {
      id: `custom-${Date.now()}`,
      nombre: name,
      precioUSD: price,
      unidad: customUnit,
      descripcionCorta: 'Producto personalizado',
      disponible: true,
      esCaja: false,
      incremento: customUnit === 'kg' ? 0.5 : 1,
      minimoKg: customUnit === 'kg' ? 0.5 : 1,
    };

    updateQuantity(customProduct, customProduct.minimoKg || 1);
    setShowCustomForm(false);
    setCustomName('');
    setCustomUnit('kg');
    setCustomPriceUSD('');
  };

  // Handle dollar amount input — calculate qty from dollar amount
  const handleDollarInput = (productId: string) => {
    const dollarStr = dollarInputValues.get(productId);
    const dollars = parseFloat(dollarStr || '0');
    const item = selectedItems.get(productId);
    if (!item || dollars <= 0) return;

    const effectivePrice = getEffectivePrice(item);
    if (effectivePrice <= 0) return;

    // Calculate quantity with high precision so subtotal matches the dollar amount
    let qty = Math.round((dollars / effectivePrice) * 10000) / 10000;
    if (qty <= 0) qty = 0.01;

    updateQuantity(item.product, qty);
    setDollarInputMode(prev => {
      const next = new Set(prev);
      next.delete(productId);
      return next;
    });
    setDollarInputValues(prev => {
      const next = new Map(prev);
      next.delete(productId);
      return next;
    });
  };

  // Input editing handlers
  const handleInputFocus = (productId: string, currentQty: number) => {
    setEditingInputs(prev => {
      const next = new Map(prev);
      next.set(productId, formatQuantity(currentQty));
      return next;
    });
  };

  const handleInputChange = (productId: string, value: string) => {
    setEditingInputs(prev => {
      const next = new Map(prev);
      next.set(productId, value);
      return next;
    });
  };

  const handleInputBlur = (product: Product) => {
    const editValue = editingInputs.get(product.id);
    const val = parseFloat(editValue || '0') || 0;
    const minQty = getMinQuantity(product);

    setEditingInputs(prev => {
      const next = new Map(prev);
      next.delete(product.id);
      return next;
    });

    if (val <= 0) {
      updateQuantity(product, 0);
    } else if (product.entradaLibre) {
      updateQuantity(product, val < minQty ? minQty : val);
    } else {
      const rounded = Math.round(val / product.incremento) * product.incremento;
      updateQuantity(product, rounded < minQty ? minQty : rounded);
    }
  };

  const getInputValue = (productId: string, quantity: number): string => {
    if (editingInputs.has(productId)) {
      return editingInputs.get(productId) || '';
    }
    return formatQuantity(quantity);
  };

  const isProductActive = (productId: string, quantity: number): boolean => {
    return quantity > 0 || editingInputs.has(productId);
  };

  // AI Parse functions
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
        precioUSD: p.precioUSD,
      }));

      const response = await fetch('/api/parse-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pastedText, products: productInfo }),
      });

      const result: ParseResponse = await response.json();

      if (result.success) {
        setParseResult(result);
      } else {
        setParseError(result.error || 'Error al procesar la lista');
      }
    } catch (error) {
      console.error('Error parseando:', error);
      setParseError('Error de conexion. Intenta de nuevo.');
    } finally {
      setIsParsing(false);
    }
  };

  const applyParsedItems = () => {
    if (!parseResult) return;

    const newItems = new Map(selectedItems);

    parseResult.items.forEach(item => {
      if (item.matched && item.productId) {
        const product = allProducts.find(p => String(p.id) === String(item.productId));
        if (product) {
          const existingQty = newItems.get(product.id)?.quantity || 0;
          const existingPrice = newItems.get(product.id)?.customPrice ?? null;
          newItems.set(product.id, {
            product,
            quantity: existingQty + item.quantity,
            customPrice: existingPrice,
          });
        }
      }
    });

    setSelectedItems(newItems);
    setPastedText('');
    setParseResult(null);
    setInputMode('manual');
  };

  const clearParsing = () => {
    setPastedText('');
    setParseResult(null);
    setParseError(null);
    setCorrections('');
  };

  const removeParseItem = (indexToRemove: number) => {
    if (!parseResult) return;
    const updatedItems = parseResult.items.filter((_, index) => index !== indexToRemove);
    setParseResult({ ...parseResult, items: updatedItems });
  };

  const reprocessWithCorrections = async () => {
    if (!corrections.trim()) return;

    const combinedText = `${pastedText}\n\nACLARACIONES DEL CLIENTE:\n${corrections}`;

    setIsParsing(true);
    setParseError(null);
    setParseResult(null);

    try {
      const productInfo = allProducts.map(p => ({
        id: p.id,
        nombre: p.nombre,
        unidad: p.unidad,
        precioUSD: p.precioUSD,
      }));

      const response = await fetch('/api/parse-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: combinedText, products: productInfo }),
      });

      const result: ParseResponse = await response.json();

      if (result.success) {
        setParseResult(result);
        setCorrections('');
      } else {
        setParseError(result.error || 'Error al procesar la lista');
      }
    } catch (error) {
      console.error('Error parseando:', error);
      setParseError('Error de conexion. Intenta de nuevo.');
    } finally {
      setIsParsing(false);
    }
  };

  // Get current date formatted
  const getCurrentDate = () => {
    const now = new Date();
    return now.toLocaleDateString('es-VE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  // Generate note number
  const getDeliveryNoteNumber = () => {
    if (presupuestoId) return presupuestoId;
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  };

  // Build items array for printing
  const buildPrintItems = () => {
    return Array.from(selectedItems.values()).map(item => ({
      nombre: item.product.nombre,
      cantidad: item.quantity,
      unidad: item.product.unidad,
      precioUSD: getEffectivePrice(item),
      subtotalUSD: Math.round(getEffectivePrice(item) * item.quantity * 100) / 100,
    }));
  };

  // Print carta (A4 format) in new window
  const printCarta = () => {
    const items = buildPrintItems();
    const noteNumber = getDeliveryNoteNumber();
    const date = getCurrentDate();

    const rows = items.map((item, i) => `
      <tr style="background:${i % 2 === 0 ? '#fff' : '#f0f9ff'}">
        <td style="border-right:1px solid #7dd3fc;padding:6px 10px;color:#0c4a6e;">${item.nombre}</td>
        <td style="border-right:1px solid #7dd3fc;padding:6px 10px;text-align:center;color:#0c4a6e;">${formatQuantity(item.cantidad)}</td>
        <td style="border-right:1px solid #7dd3fc;padding:6px 10px;text-align:center;color:#0c4a6e;">${item.unidad}</td>
        <td style="border-right:1px solid #7dd3fc;padding:6px 10px;text-align:right;color:#0c4a6e;">${formatUSD(item.precioUSD)}</td>
        <td style="padding:6px 10px;text-align:right;font-weight:600;color:#0c4a6e;">${formatUSD(item.subtotalUSD)}</td>
      </tr>
    `).join('');

    const deliveryRow = deliveryCost > 0 ? `
      <tr style="background:#fffbeb;">
        <td style="border-right:1px solid #7dd3fc;padding:6px 10px;color:#0c4a6e;font-style:italic;">Delivery</td>
        <td style="border-right:1px solid #7dd3fc;padding:6px 10px;text-align:center;color:#0c4a6e;">1</td>
        <td style="border-right:1px solid #7dd3fc;padding:6px 10px;text-align:center;color:#0c4a6e;">servicio</td>
        <td style="border-right:1px solid #7dd3fc;padding:6px 10px;text-align:right;color:#0c4a6e;">${formatUSD(deliveryCost)}</td>
        <td style="padding:6px 10px;text-align:right;font-weight:600;color:#0c4a6e;">${formatUSD(deliveryCost)}</td>
      </tr>
    ` : '';

    const printWindow = window.open('', '_blank', 'width=800,height=900');
    if (!printWindow) return;

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Presupuesto RPYM - ${noteNumber}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: white;
      color: #0c4a6e;
      width: 210mm;
      margin: 0 auto;
      padding: 12mm 15mm;
      position: relative;
    }
    table { width:100%; border-collapse:collapse; }
    @media print {
      body { padding: 0; }
      @page { size: A4; margin: 12mm 15mm; }
    }
    .watermark {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-30deg);
      font-size: 80px;
      font-weight: 900;
      color: rgba(14, 165, 233, 0.06);
      letter-spacing: 12px;
      pointer-events: none;
      z-index: 0;
    }
  </style>
</head>
<body>
  <div class="watermark">PRESUPUESTO</div>

  ${markAsPaid ? `
  <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-15deg);border:6px solid #16a34a;border-radius:12px;padding:15px 40px;color:#16a34a;font-size:36px;font-weight:900;text-transform:uppercase;letter-spacing:3px;opacity:0.35;pointer-events:none;z-index:1;">
    PAGADO
  </div>
  ` : ''}

  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;border:2px solid #075985;padding:12px 16px;margin-bottom:16px;">
    <div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
        <div style="width:48px;height:48px;border-radius:50%;border:2px solid #7dd3fc;overflow:hidden;flex-shrink:0;background:white;display:flex;align-items:center;justify-content:center;">
          <img src="/camaronlogo-sm.webp" alt="RPYM" style="width:140%;height:140%;object-fit:contain;" />
        </div>
        <div style="font-size:22px;font-weight:800;color:#0c4a6e;">RPYM</div>
      </div>
      <div style="font-size:10px;color:#0369a1;">Muelle Pesquero "El Mosquero", Puesto 3 y 4, Maiquetia</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:16px;font-weight:700;color:#0c4a6e;border-bottom:2px solid #075985;padding-bottom:4px;margin-bottom:6px;">PRESUPUESTO</div>
      <div style="font-size:10px;color:#0369a1;">No: <span style="font-family:monospace;font-weight:600;color:#0c4a6e;">${noteNumber}</span></div>
      <div style="font-size:10px;color:#0369a1;margin-top:2px;">Fecha: <span style="font-weight:600;color:#0c4a6e;">${date}</span></div>
    </div>
  </div>

  <!-- Client info -->
  <div style="border:2px solid #075985;padding:10px 16px;margin-bottom:16px;">
    <div style="margin-bottom:6px;">
      <span style="font-size:10px;font-weight:600;color:#0369a1;">Cliente:</span>
      <span style="font-size:12px;color:#0c4a6e;margin-left:8px;">${customerName || '---'}</span>
    </div>
    <div>
      <span style="font-size:10px;font-weight:600;color:#0369a1;">Direccion:</span>
      <span style="font-size:12px;color:#0c4a6e;margin-left:8px;">${customerAddress || '---'}</span>
    </div>
  </div>

  <!-- Products table -->
  <div style="border:2px solid #075985;margin-bottom:16px;">
    <table>
      <thead>
        <tr style="background:#e0f2fe;">
          <th style="border-bottom:2px solid #075985;border-right:1px solid #075985;padding:8px 10px;text-align:left;font-size:11px;font-weight:700;color:#0c4a6e;">Producto</th>
          <th style="border-bottom:2px solid #075985;border-right:1px solid #075985;padding:8px 10px;text-align:center;font-size:11px;font-weight:700;color:#0c4a6e;width:60px;">Cant</th>
          <th style="border-bottom:2px solid #075985;border-right:1px solid #075985;padding:8px 10px;text-align:center;font-size:11px;font-weight:700;color:#0c4a6e;width:60px;">Unidad</th>
          <th style="border-bottom:2px solid #075985;border-right:1px solid #075985;padding:8px 10px;text-align:right;font-size:11px;font-weight:700;color:#0c4a6e;width:80px;">P.Unitario</th>
          <th style="border-bottom:2px solid #075985;padding:8px 10px;text-align:right;font-size:11px;font-weight:700;color:#0c4a6e;width:80px;">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        ${deliveryRow}
      </tbody>
    </table>
  </div>

  <!-- Totals -->
  <div style="border:2px solid #075985;margin-bottom:16px;display:flex;">
    <div style="flex:1;padding:10px 16px;border-right:2px solid #075985;">
      <div style="font-size:10px;font-weight:600;color:#0369a1;margin-bottom:4px;">OBSERVACIONES:</div>
      ${soloDivisas ? '<div style="font-size:10px;color:#0369a1;">Precios en USD</div>' : `<div style="font-size:10px;color:#0369a1;">Tasa BCV del dia: Bs. ${bcvRate.rate.toFixed(2)} por USD</div>`}
    </div>
    <div style="width:200px;padding:10px 16px;">
      ${deliveryCost > 0 ? `
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px;">
        <span style="color:#0369a1;">Subtotal:</span>
        <span style="font-weight:600;color:#0c4a6e;">${formatUSD(totals.subtotalUSD)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:6px;">
        <span style="color:#0369a1;">Delivery:</span>
        <span style="font-weight:600;color:#0c4a6e;">${formatUSD(totals.deliveryUSD)}</span>
      </div>
      ` : ''}
      <div style="display:flex;justify-content:space-between;font-size:13px;${deliveryCost > 0 ? 'border-top:1px solid #7dd3fc;padding-top:6px;' : ''}">
        <span style="color:#0369a1;font-weight:600;">Total USD:</span>
        <span style="font-weight:800;color:#0c4a6e;">${formatUSD(totals.totalUSD)}</span>
      </div>
      ${soloDivisas ? '' : `<div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px;border-top:1px solid #7dd3fc;padding-top:4px;">
        <span style="color:#0369a1;">Total Bs.:</span>
        <span style="font-weight:700;color:#ea580c;">${formatBs(totals.totalBs)}</span>
      </div>`}
    </div>
  </div>

  <!-- Signatures -->
  <div style="display:flex;gap:40px;margin-top:40px;">
    <div style="flex:1;text-align:center;">
      <div style="border-top:2px solid #075985;padding-top:6px;margin:0 30px;">
        <span style="font-size:10px;font-weight:600;color:#0369a1;">CONFORME CLIENTE</span>
      </div>
    </div>
    <div style="flex:1;text-align:center;">
      <div style="border-top:2px solid #075985;padding-top:6px;margin:0 30px;">
        <span style="font-size:10px;font-weight:600;color:#0369a1;">ENTREGADO POR</span>
      </div>
    </div>
  </div>

  ${markAsPaid ? `
  <div style="background:#dcfce7;color:#166534;padding:12px;border-radius:8px;text-align:center;margin-top:16px;font-weight:600;font-size:13px;">
    Gracias por su compra!
  </div>
  ` : ''}

  <!-- Non-fiscal notice -->
  <div style="margin-top:${markAsPaid ? '8' : '20'}px;padding:6px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:4px;text-align:center;">
    <span style="font-size:10px;color:#b45309;font-weight:500;">Este documento no tiene validez fiscal - Solo para referencia</span>
  </div>

  <!-- Footer -->
  <div style="margin-top:12px;padding-top:8px;border-top:1px solid #bae6fd;text-align:center;">
    <span style="font-size:10px;color:#0ea5e9;">www.rpym.net &bull; WhatsApp: +58 414-214-5202</span>
  </div>
</body>
</html>`);

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); }, 300);
  };

  // WhatsApp compact screenshot version
  const openWhatsAppView = () => {
    const items = buildPrintItems();
    const noteNumber = getDeliveryNoteNumber();
    const date = getCurrentDate();

    const productRows = items.map(item => `
      <div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;border-bottom:1px solid #f0f9ff;">
        <div style="flex:1;font-size:13px;color:#0c4a6e;">${item.nombre}</div>
        <div style="font-size:12px;color:#0369a1;margin:0 8px;white-space:nowrap;">${formatQuantity(item.cantidad)} ${item.unidad}</div>
        <div style="font-size:13px;font-weight:600;color:#0c4a6e;white-space:nowrap;">${formatUSD(item.subtotalUSD)}</div>
      </div>
    `).join('');

    const deliveryLine = deliveryCost > 0 ? `
      <div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;border-bottom:1px solid #f0f9ff;">
        <div style="flex:1;font-size:13px;color:#0c4a6e;font-style:italic;">Delivery</div>
        <div style="font-size:13px;font-weight:600;color:#0c4a6e;white-space:nowrap;">${formatUSD(deliveryCost)}</div>
      </div>
    ` : '';

    const waWindow = window.open('', '_blank', 'width=380,height=700,scrollbars=yes');
    if (!waWindow) return;

    waWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Presupuesto RPYM</title>
  <meta name="viewport" content="width=320" />
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f0f9ff;
      display: flex;
      justify-content: center;
      padding: 16px 0;
    }
  </style>
</head>
<body>
  <div style="width:320px;background:white;border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <!-- Logo -->
    <div style="text-align:center;margin-bottom:12px;">
      <img src="/camaronlogo-sm.webp" alt="RPYM" style="width:140px;height:auto;object-fit:contain;margin:0 auto;" />
      <div style="font-size:12px;color:#0369a1;margin-top:4px;">Presupuesto</div>
      ${markAsPaid ? '<div style="display:inline-flex;align-items:center;gap:4px;background:#dcfce7;color:#166534;font-size:12px;font-weight:600;padding:3px 10px;border-radius:9999px;margin-top:6px;">PAGADO</div>' : ''}
    </div>

    ${customerName ? `<div style="font-size:12px;color:#0369a1;text-align:center;margin-bottom:10px;">Cliente: <strong style="color:#0c4a6e;">${customerName}</strong></div>` : ''}

    <!-- Products -->
    <div style="margin-bottom:12px;">
      ${productRows}
      ${deliveryLine}
    </div>

    <!-- Totals -->
    <div style="border-top:2px solid #075985;padding-top:10px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="font-size:14px;font-weight:600;color:#0369a1;">Total USD</span>
        <span style="font-size:20px;font-weight:800;color:#0c4a6e;">${formatUSD(totals.totalUSD)}</span>
      </div>
      ${soloDivisas ? '' : `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px;">
        <span style="font-size:12px;color:#0369a1;">Total Bs.</span>
        <span style="font-size:15px;font-weight:700;color:#ea580c;">${formatBs(totals.totalBs)}</span>
      </div>`}
    </div>

    <!-- Footer -->
    <div style="text-align:center;border-top:1px solid #e0f2fe;padding-top:8px;">
      <div style="font-size:10px;color:#0ea5e9;">${date}</div>
      <div style="font-size:10px;color:#0ea5e9;margin-top:2px;">WhatsApp: +58 414-214-5202</div>
      <div style="font-size:9px;color:#7dd3fc;margin-top:4px;">Ref: ${noteNumber}</div>
    </div>
  </div>
</body>
</html>`);

    waWindow.document.close();
  };

  // Save to Google Sheets
  const handleSave = async () => {
    if (selectedItems.size === 0) return;

    setIsSaving(true);
    setSaveMessage(null);

    try {
      const items = Array.from(selectedItems.values()).map(item => ({
        nombre: item.product.nombre,
        cantidad: item.quantity,
        unidad: item.product.unidad,
        precioUSD: getEffectivePrice(item),
        precioBs: Math.round(getEffectivePrice(item) * bcvRate.rate * 100) / 100,
        subtotalUSD: Math.round(getEffectivePrice(item) * item.quantity * 100) / 100,
        subtotalBs: Math.round(getEffectivePrice(item) * item.quantity * bcvRate.rate * 100) / 100,
      }));

      let result;

      if (editingPresupuesto) {
        // Update existing presupuesto
        result = await updatePresupuesto({
          id: editingPresupuesto.id,
          items,
          totalUSD: totals.totalUSD,
          totalBs: totals.totalBs,
          customerName,
          customerAddress,
        });
        if (result.success) {
          setSaveMessage(`Actualizado: ${editingPresupuesto.id}`);
          onEditComplete?.();
        } else {
          setSaveMessage('Error al actualizar. Intenta de nuevo.');
        }
      } else {
        result = await savePresupuesto({
          items,
          totalUSD: totals.totalUSD,
          totalBs: totals.totalBs,
          customerName,
          customerAddress,
          status: markAsPaid ? 'pagado' : 'pendiente',
          source: 'admin',
        });
        if (result.success && result.id) {
          setPresupuestoId(result.id);
          setSaveMessage(`Guardado con ID: ${result.id}`);
        } else {
          setSaveMessage('Error al guardar. Intenta de nuevo.');
        }
      }
    } catch (error) {
      console.error('Error guardando presupuesto:', error);
      setSaveMessage('Error de conexion al guardar.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-ocean-100 p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-coral-100 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-coral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-ocean-900">Constructor de Presupuesto</h2>
              <p className="text-xs text-ocean-700">Admin - Precios editables</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse"></span>
            <div className="text-right">
              <span className="text-xs text-ocean-600 block leading-tight">Tasa BCV</span>
              <span className="text-base font-bold text-ocean-900">Bs. {bcvRate.rate.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Customer info + Delivery */}
      <div className="bg-white rounded-xl shadow-sm border border-ocean-100 p-4">
        <h3 className="text-sm font-semibold text-ocean-900 mb-3">Datos del Cliente</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-ocean-700 mb-1 block">Nombre del cliente</label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Nombre..."
              className="w-full px-3 py-2 text-sm border border-ocean-200 rounded-lg focus:ring-2 focus:ring-ocean-500 focus:border-transparent outline-none text-ocean-900"
            />
          </div>
          <div>
            <label className="text-xs text-ocean-700 mb-1 block">Direccion</label>
            <input
              type="text"
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              placeholder="Direccion de entrega..."
              className="w-full px-3 py-2 text-sm border border-ocean-200 rounded-lg focus:ring-2 focus:ring-ocean-500 focus:border-transparent outline-none text-ocean-900"
            />
          </div>
          <div>
            <label className="text-xs text-ocean-700 mb-1 block">Costo de delivery (USD)</label>
            <input
              type="number"
              value={editingDelivery !== null ? editingDelivery : deliveryCost}
              onFocus={() => setEditingDelivery(deliveryCost === 0 ? '' : String(deliveryCost))}
              onChange={(e) => setEditingDelivery(e.target.value)}
              onBlur={() => {
                const val = parseFloat(editingDelivery || '0') || 0;
                setDeliveryCost(Math.min(20, Math.max(0, val)));
                setEditingDelivery(null);
              }}
              min="0"
              max="20"
              step="0.5"
              className="w-full px-3 py-2 text-sm border border-ocean-200 rounded-lg focus:ring-2 focus:ring-ocean-500 focus:border-transparent outline-none text-ocean-900
                [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
        </div>
      </div>

      {/* Mode tabs: Manual vs Paste */}
      <div className="flex gap-2">
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
          Seleccionar Productos
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
      </div>

      {/* AI Paste Mode */}
      {inputMode === 'paste' && (
        <div className="bg-white rounded-xl p-4 md:p-6 shadow-sm border border-coral-200">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 bg-coral-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <span className="text-xl">&#10024;</span>
            </div>
            <div>
              <h3 className="font-semibold text-ocean-900">Pega tu lista</h3>
              <p className="text-sm text-ocean-600">
                Copia la lista del cliente y calculamos el presupuesto al instante
              </p>
            </div>
          </div>

          {!parseResult ? (
            <>
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder={`Ejemplo:\n1kg jaiba\n1/2kg camarones 41/50\n500gr langostino\n2 cajas camaron 61/70`}
                className="w-full h-40 p-4 border border-ocean-200 rounded-xl text-sm resize-none
                  focus:outline-none focus:ring-2 focus:ring-coral-500 focus:border-transparent
                  placeholder:text-ocean-400 text-ocean-900"
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
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-ocean-900">Productos identificados</h4>
                <button onClick={clearParsing} className="text-sm text-ocean-600 hover:text-ocean-800">
                  Editar lista
                </button>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {parseResult.items.map((item, index) => (
                  <div
                    key={index}
                    className={`p-3 rounded-xl border ${
                      item.matched ? 'bg-green-50 border-green-200' : 'bg-orange-50 border-orange-200'
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
                          <p className="text-xs text-ocean-500 mt-0.5 ml-6">Pedido: "{item.requestedName}"</p>
                        )}
                        {!item.matched && (
                          <p className="text-xs text-orange-700 mt-1 ml-6">No encontrado en el catalogo</p>
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

              {/* Corrections */}
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl">
                <div className="flex items-start gap-2 mb-2">
                  <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-blue-800">Algo no esta bien?</p>
                    <p className="text-xs text-blue-600">
                      Escribe correcciones como: "el camaron es con concha, no pelado"
                    </p>
                  </div>
                </div>
                <textarea
                  value={corrections}
                  onChange={(e) => setCorrections(e.target.value)}
                  placeholder='Ej: el camaron 41/50 es con concha, no desvenado...'
                  className="w-full h-20 p-2 text-sm border border-blue-200 rounded-lg resize-none
                    focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent
                    placeholder:text-blue-400 text-ocean-900"
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

              {/* Estimated total */}
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

      {/* Main content: product selection + summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Product selection panel */}
        {inputMode === 'manual' && (
          <div className="lg:col-span-2 space-y-4">
            {/* Search bar + category nav (sticky) */}
            <div className="sticky top-24 z-10 bg-ocean-50 pb-2 space-y-3">
            <div className="relative">
              <svg className="w-5 h-5 text-ocean-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar producto..."
                className="w-full pl-10 pr-4 py-2.5 text-sm border border-ocean-200 rounded-lg focus:ring-2 focus:ring-ocean-500 focus:border-transparent outline-none text-ocean-900 bg-white"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ocean-400 hover:text-ocean-600"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Category nav */}
            {!searchQuery && (
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {categories.map((category) => (
                  <button
                    key={category.name}
                    onClick={() => {
                      setActiveCategory(category.name);
                      const el = document.getElementById(`admin-cat-${category.name}`);
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all
                      ${activeCategory === category.name
                        ? 'bg-ocean-600 text-white shadow-md'
                        : 'bg-white text-ocean-700 border border-ocean-200'
                      }`}
                  >
                    <span className="mr-1.5">{categoryIcons[category.name] || '&#128032;'}</span>
                    {category.name}
                  </button>
                ))}
              </div>
            )}
            </div>

            {/* Products grid */}
            {filteredCategories.map((category) => (
              <div key={category.name} id={`admin-cat-${category.name}`} className="scroll-mt-40">
                <h3 className="text-base font-semibold text-ocean-800 mb-2 flex items-center gap-2">
                  <span>{categoryIcons[category.name] || '&#128032;'}</span>
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
                        className={`bg-white rounded-xl p-3 transition-all border-2
                          ${isSelected
                            ? 'border-coral-400 shadow-md shadow-coral-100'
                            : 'border-transparent shadow-sm'
                          }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="font-medium text-ocean-900 text-sm">{product.nombre}</span>
                              {product.masVendido && (
                                <span className="bg-coral-100 text-coral-600 text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                                  Popular
                                </span>
                              )}
                            </div>
                            <div className="flex items-baseline gap-2">
                              <span className="text-coral-500 font-bold text-sm">{formatUSD(product.precioUSD)}</span>
                              <span className="text-ocean-600 text-xs">/{product.unidad}</span>
                            </div>
                          </div>

                          {/* Quantity controls */}
                          <div className="flex-shrink-0">
                            {!isSelected ? (
                              <button
                                onClick={() => quickAdd(product)}
                                className="w-9 h-9 rounded-xl bg-coral-500 text-white font-bold text-lg
                                  flex items-center justify-center active:scale-95 transition-transform
                                  shadow-md shadow-coral-200"
                              >
                                +
                              </button>
                            ) : (
                              <div className="flex items-center gap-1 bg-ocean-50 rounded-xl p-1">
                                <button
                                  onClick={() => {
                                    const minQty = getMinQuantity(product);
                                    const newQty = quantity - product.incremento;
                                    updateQuantity(product, newQty < minQty ? 0 : newQty);
                                  }}
                                  className="w-7 h-7 rounded-lg bg-white text-ocean-700 font-bold text-sm
                                    flex items-center justify-center active:bg-ocean-100 transition-colors shadow-sm"
                                >
                                  -
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
                                  className="w-7 h-7 rounded-lg bg-coral-500 text-white font-bold text-sm
                                    flex items-center justify-center active:bg-coral-600 transition-colors shadow-sm"
                                >
                                  +
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Subtotal row with editable price */}
                        {quantity > 0 && (
                          <div className="mt-2 pt-2 border-t border-ocean-100 space-y-1.5">
                            {/* Dollar input for grid */}
                            {dollarInputMode.has(product.id) && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-ocean-500">Monto $:</span>
                                <div className="relative flex-1">
                                  <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-ocean-400">$</span>
                                  <input
                                    type="number"
                                    value={dollarInputValues.get(product.id) || ''}
                                    onChange={(e) => {
                                      setDollarInputValues(prev => {
                                        const next = new Map(prev);
                                        next.set(product.id, e.target.value);
                                        return next;
                                      });
                                    }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleDollarInput(product.id); }}
                                    autoFocus
                                    step="0.01"
                                    min="0"
                                    placeholder="20.00"
                                    className="w-full pl-4 pr-1 py-1 text-xs border border-ocean-300 rounded
                                      focus:ring-1 focus:ring-ocean-500 outline-none
                                      [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
                                      text-ocean-900 bg-white"
                                  />
                                </div>
                                <button
                                  onClick={() => handleDollarInput(product.id)}
                                  className="px-2 py-1 bg-coral-500 text-white text-[10px] rounded hover:bg-coral-600 transition-colors"
                                >
                                  OK
                                </button>
                                <button
                                  onClick={() => {
                                    setDollarInputMode(prev => { const next = new Set(prev); next.delete(product.id); return next; });
                                    setDollarInputValues(prev => { const next = new Map(prev); next.delete(product.id); return next; });
                                  }}
                                  className="text-ocean-400 hover:text-ocean-600"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                            )}
                            <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-ocean-600">
                                {formatQuantity(quantity)} {product.unidad}
                              </span>
                              {!dollarInputMode.has(product.id) && (
                                <button
                                  onClick={() => {
                                    setDollarInputMode(prev => { const next = new Set(prev); next.add(product.id); return next; });
                                  }}
                                  className="text-[10px] text-ocean-400 hover:text-coral-500 border border-ocean-200 hover:border-coral-300 rounded px-1 py-0.5 transition-colors"
                                  title="Ingresar monto en dolares"
                                >
                                  $→{product.unidad}
                                </button>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {/* Editable price */}
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-ocean-500">P.U.:</span>
                                {selectedItems.get(product.id)?.customPrice !== null && selectedItems.get(product.id)?.customPrice !== undefined && (
                                  <span className="text-[10px] text-ocean-400 line-through">
                                    {formatUSD(product.precioUSD)}
                                  </span>
                                )}
                                <div className="relative">
                                  <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-ocean-400">$</span>
                                  <input
                                    type="number"
                                    value={editingPrices.has(product.id) ? editingPrices.get(product.id) : getEffectivePrice(selectedItems.get(product.id)!)}
                                    onFocus={() => {
                                      setEditingPrices(prev => {
                                        const next = new Map(prev);
                                        next.set(product.id, String(getEffectivePrice(selectedItems.get(product.id)!)));
                                        return next;
                                      });
                                    }}
                                    onChange={(e) => {
                                      setEditingPrices(prev => {
                                        const next = new Map(prev);
                                        next.set(product.id, e.target.value);
                                        return next;
                                      });
                                    }}
                                    onBlur={() => {
                                      const editValue = editingPrices.get(product.id);
                                      const val = parseFloat(editValue || '0') || 0;
                                      if (val === product.precioUSD) {
                                        updateCustomPrice(product.id, null);
                                      } else {
                                        updateCustomPrice(product.id, val);
                                      }
                                      setEditingPrices(prev => {
                                        const next = new Map(prev);
                                        next.delete(product.id);
                                        return next;
                                      });
                                    }}
                                    step="0.01"
                                    min="0"
                                    className="w-20 pl-4 pr-1 py-0.5 text-xs text-right border border-ocean-200 rounded-md
                                      focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none
                                      [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
                                      text-ocean-900 bg-ocean-50"
                                  />
                                </div>
                                {selectedItems.get(product.id)?.customPrice !== null && selectedItems.get(product.id)?.customPrice !== undefined && (
                                  <button
                                    onClick={() => updateCustomPrice(product.id, null)}
                                    className="text-ocean-400 hover:text-ocean-600"
                                    title="Restaurar precio original"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                              <span className="text-sm font-semibold text-coral-500">
                                = {formatUSD(getEffectivePrice(selectedItems.get(product.id)!) * quantity)}
                              </span>
                            </div>
                          </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Summary panel */}
        <div className={`${inputMode === 'manual' ? 'lg:col-span-1' : 'lg:col-span-3'}`}>
          <div className="bg-white rounded-xl p-5 shadow-sm border border-ocean-100 sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto">
            <h3 className="text-lg font-semibold text-ocean-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-coral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Resumen del Presupuesto
            </h3>

            {selectedItems.size === 0 ? (
              <div className="text-center py-8 text-ocean-600">
                <svg className="w-16 h-16 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
                <p className="text-sm">Agrega productos para construir el presupuesto</p>
                {/* Custom product - also available when empty */}
                {!showCustomForm ? (
                  <button
                    onClick={() => setShowCustomForm(true)}
                    className="w-full mt-4 py-2 border-2 border-dashed border-ocean-200 text-ocean-500 hover:border-ocean-400 hover:text-ocean-700 rounded-xl text-sm transition-colors flex items-center justify-center gap-1.5"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Producto personalizado
                  </button>
                ) : (
                  <div className="mt-4 p-3 border border-ocean-200 rounded-xl space-y-2 bg-ocean-50 text-left">
                    <p className="text-xs font-medium text-ocean-700">Nuevo producto</p>
                    <input
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder="Nombre del producto"
                      className="w-full px-2.5 py-1.5 text-sm border border-ocean-200 rounded-lg outline-none focus:ring-1 focus:ring-ocean-500 text-ocean-900 bg-white"
                    />
                    <div className="flex gap-2">
                      <select
                        value={customUnit}
                        onChange={(e) => setCustomUnit(e.target.value)}
                        className="flex-1 px-2 py-1.5 text-sm border border-ocean-200 rounded-lg outline-none focus:ring-1 focus:ring-ocean-500 text-ocean-900 bg-white"
                      >
                        <option value="kg">kg</option>
                        <option value="unidad">unidad</option>
                        <option value="paquete">paquete</option>
                      </select>
                      <div className="relative flex-1">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ocean-400">$</span>
                        <input
                          type="number"
                          value={customPriceUSD}
                          onChange={(e) => setCustomPriceUSD(e.target.value)}
                          placeholder="Precio"
                          step="0.01"
                          min="0"
                          className="w-full pl-5 pr-2 py-1.5 text-sm border border-ocean-200 rounded-lg outline-none focus:ring-1 focus:ring-ocean-500
                            [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
                            text-ocean-900 bg-white"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setShowCustomForm(false); setCustomName(''); setCustomPriceUSD(''); }}
                        className="flex-1 py-1.5 text-sm text-ocean-600 hover:bg-ocean-100 rounded-lg transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={addCustomProduct}
                        disabled={!customName.trim() || !customPriceUSD || parseFloat(customPriceUSD) <= 0}
                        className="flex-1 py-1.5 text-sm bg-coral-500 text-white rounded-lg hover:bg-coral-600 disabled:bg-ocean-200 disabled:text-ocean-400 transition-colors"
                      >
                        Agregar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Selected items list */}
                <div className="space-y-2 mb-4 max-h-72 overflow-y-auto">
                  {Array.from(selectedItems.values()).map((item) => {
                    const effectivePrice = getEffectivePrice(item);
                    const hasCustomPrice = item.customPrice !== null;
                    return (
                      <div key={item.product.id} className="bg-ocean-50 rounded-lg p-3">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span className="text-ocean-800 text-sm font-medium leading-tight">{item.product.nombre}</span>
                          <button
                            onClick={() => updateQuantity(item.product, 0)}
                            className="flex-shrink-0 w-5 h-5 rounded-full bg-red-100 hover:bg-red-200 text-red-600
                              flex items-center justify-center transition-colors"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                        {/* Dollar input mode for this item */}
                        {dollarInputMode.has(item.product.id) ? (
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-[11px] text-ocean-500">Monto $:</span>
                            <div className="relative flex-1">
                              <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-ocean-400">$</span>
                              <input
                                type="number"
                                value={dollarInputValues.get(item.product.id) || ''}
                                onChange={(e) => {
                                  setDollarInputValues(prev => {
                                    const next = new Map(prev);
                                    next.set(item.product.id, e.target.value);
                                    return next;
                                  });
                                }}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleDollarInput(item.product.id); }}
                                autoFocus
                                step="0.01"
                                min="0"
                                placeholder="20.00"
                                className="w-full pl-4 pr-1 py-1 text-xs border border-ocean-300 rounded
                                  focus:ring-1 focus:ring-ocean-500 outline-none
                                  [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
                                  text-ocean-900 bg-white"
                              />
                            </div>
                            <button
                              onClick={() => handleDollarInput(item.product.id)}
                              className="px-2 py-1 bg-coral-500 text-white text-[10px] rounded hover:bg-coral-600 transition-colors"
                            >
                              OK
                            </button>
                            <button
                              onClick={() => {
                                setDollarInputMode(prev => { const next = new Set(prev); next.delete(item.product.id); return next; });
                                setDollarInputValues(prev => { const next = new Map(prev); next.delete(item.product.id); return next; });
                              }}
                              className="text-ocean-400 hover:text-ocean-600"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between text-xs gap-2">
                            <div className="flex items-center gap-1">
                              <span className="text-ocean-600">
                                {formatQuantity(item.quantity)} {item.product.unidad} x{' '}
                              </span>
                              <button
                                onClick={() => {
                                  setDollarInputMode(prev => { const next = new Set(prev); next.add(item.product.id); return next; });
                                }}
                                className="text-[10px] text-ocean-400 hover:text-coral-500 border border-ocean-200 hover:border-coral-300 rounded px-1 py-0.5 transition-colors"
                                title="Ingresar monto en dolares"
                              >
                                $→{item.product.unidad}
                              </button>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {hasCustomPrice && (
                                <span className="line-through text-ocean-400 text-[10px]">{formatUSD(item.product.precioUSD)}</span>
                              )}
                              <div className="relative">
                                <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] text-ocean-400">$</span>
                                <input
                                  type="number"
                                  value={editingSummaryPrices.has(item.product.id) ? editingSummaryPrices.get(item.product.id) : effectivePrice}
                                  onFocus={() => {
                                    setEditingSummaryPrices(prev => {
                                      const next = new Map(prev);
                                      next.set(item.product.id, String(effectivePrice));
                                      return next;
                                    });
                                  }}
                                  onChange={(e) => {
                                    setEditingSummaryPrices(prev => {
                                      const next = new Map(prev);
                                      next.set(item.product.id, e.target.value);
                                      return next;
                                    });
                                  }}
                                  onBlur={() => {
                                    const editValue = editingSummaryPrices.get(item.product.id);
                                    const val = parseFloat(editValue || '0') || 0;
                                    if (val === item.product.precioUSD) {
                                      updateCustomPrice(item.product.id, null);
                                    } else {
                                      updateCustomPrice(item.product.id, val);
                                    }
                                    setEditingSummaryPrices(prev => {
                                      const next = new Map(prev);
                                      next.delete(item.product.id);
                                      return next;
                                    });
                                  }}
                                  step="0.01"
                                  min="0"
                                  className="w-16 pl-3 pr-0.5 py-0.5 text-[11px] text-right border border-ocean-200 rounded
                                    focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none
                                    [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
                                    text-ocean-900 bg-white"
                                />
                              </div>
                              <span className="font-semibold text-coral-500 whitespace-nowrap">{formatUSD(effectivePrice * item.quantity)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Toggles */}
                <div className="space-y-1.5 py-2 mb-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="solo-divisas" className="text-xs text-ocean-600 cursor-pointer">Solo divisas (ocultar Bs.)</label>
                    <button
                      id="solo-divisas"
                      onClick={() => setSoloDivisas(!soloDivisas)}
                      className={`relative w-9 h-5 rounded-full transition-colors ${soloDivisas ? 'bg-coral-500' : 'bg-ocean-200'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${soloDivisas ? 'translate-x-4' : ''}`} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="mark-paid" className="text-xs text-ocean-600 cursor-pointer">Marcar como pagado</label>
                    <button
                      id="mark-paid"
                      onClick={() => setMarkAsPaid(!markAsPaid)}
                      className={`relative w-9 h-5 rounded-full transition-colors ${markAsPaid ? 'bg-green-500' : 'bg-ocean-200'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${markAsPaid ? 'translate-x-4' : ''}`} />
                    </button>
                  </div>
                </div>

                {/* Totals */}
                <div className="border-t border-ocean-200 pt-3 space-y-2">
                  {deliveryCost > 0 && (
                    <>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-ocean-600">Subtotal</span>
                        <span className="font-medium text-ocean-900">{formatUSD(totals.subtotalUSD)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-ocean-600">Delivery</span>
                        <span className="font-medium text-ocean-900">{formatUSD(totals.deliveryUSD)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-ocean-600">Total USD</span>
                    <span className="text-2xl font-bold text-coral-500">{formatUSD(totals.totalUSD)}</span>
                  </div>
                  {!soloDivisas && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-ocean-600">Total Bs.</span>
                      <span className="text-lg font-semibold text-ocean-700">{formatBs(totals.totalBs)}</span>
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="mt-4 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={printCarta}
                      className="py-2.5 bg-ocean-100 text-ocean-700 hover:bg-ocean-200 rounded-xl
                        transition-colors flex items-center justify-center gap-2 text-sm font-medium"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                      </svg>
                      Imprimir Carta
                    </button>
                    <button
                      onClick={openWhatsAppView}
                      className="py-2.5 bg-ocean-100 text-ocean-700 hover:bg-ocean-200 rounded-xl
                        transition-colors flex items-center justify-center gap-2 text-sm font-medium"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      Vista WhatsApp
                    </button>
                  </div>

                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="w-full py-3 bg-coral-500 hover:bg-coral-600 disabled:bg-ocean-200 disabled:cursor-not-allowed
                      text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    {isSaving ? (
                      <>
                        <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Guardando...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                        </svg>
                        {editingPresupuesto ? 'Actualizar Presupuesto' : 'Guardar Presupuesto'}
                      </>
                    )}
                  </button>

                  {saveMessage && (
                    <p className={`text-xs text-center ${saveMessage.includes('Error') ? 'text-red-600' : 'text-green-600'}`}>
                      {saveMessage}
                    </p>
                  )}

                  <button
                    onClick={clearSelection}
                    className="w-full py-2 text-ocean-600 hover:text-ocean-800 text-sm transition-colors"
                  >
                    Limpiar seleccion
                  </button>
                </div>

                {/* Custom product */}
                {!showCustomForm ? (
                  <button
                    onClick={() => setShowCustomForm(true)}
                    className="w-full mt-2 py-2 border-2 border-dashed border-ocean-200 text-ocean-500 hover:border-ocean-400 hover:text-ocean-700 rounded-xl text-sm transition-colors flex items-center justify-center gap-1.5"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Producto personalizado
                  </button>
                ) : (
                  <div className="mt-2 p-3 border border-ocean-200 rounded-xl space-y-2 bg-ocean-50">
                    <p className="text-xs font-medium text-ocean-700">Nuevo producto</p>
                    <input
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder="Nombre del producto"
                      className="w-full px-2.5 py-1.5 text-sm border border-ocean-200 rounded-lg outline-none focus:ring-1 focus:ring-ocean-500 text-ocean-900 bg-white"
                    />
                    <div className="flex gap-2">
                      <select
                        value={customUnit}
                        onChange={(e) => setCustomUnit(e.target.value)}
                        className="flex-1 px-2 py-1.5 text-sm border border-ocean-200 rounded-lg outline-none focus:ring-1 focus:ring-ocean-500 text-ocean-900 bg-white"
                      >
                        <option value="kg">kg</option>
                        <option value="unidad">unidad</option>
                        <option value="paquete">paquete</option>
                      </select>
                      <div className="relative flex-1">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ocean-400">$</span>
                        <input
                          type="number"
                          value={customPriceUSD}
                          onChange={(e) => setCustomPriceUSD(e.target.value)}
                          placeholder="Precio"
                          step="0.01"
                          min="0"
                          className="w-full pl-5 pr-2 py-1.5 text-sm border border-ocean-200 rounded-lg outline-none focus:ring-1 focus:ring-ocean-500
                            [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
                            text-ocean-900 bg-white"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setShowCustomForm(false); setCustomName(''); setCustomPriceUSD(''); }}
                        className="flex-1 py-1.5 text-sm text-ocean-600 hover:bg-ocean-100 rounded-lg transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={addCustomProduct}
                        disabled={!customName.trim() || !customPriceUSD || parseFloat(customPriceUSD) <= 0}
                        className="flex-1 py-1.5 text-sm bg-coral-500 text-white rounded-lg hover:bg-coral-600 disabled:bg-ocean-200 disabled:text-ocean-400 transition-colors"
                      >
                        Agregar
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            <p className="text-xs text-ocean-600 mt-4 text-center">
              * Precios calculados con tasa BCV
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
