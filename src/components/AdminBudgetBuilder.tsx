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
  customPriceDivisa: number | null; // null = use default divisa price
}

// Tipos para el parsing con IA
interface ParsedItem {
  productId: string | null;
  productName: string | null;
  requestedName: string;
  suggestedName?: string | null; // Nombre sugerido para producto personalizado
  quantity: number;
  unit: string;
  matched: boolean;
  confidence: 'high' | 'medium' | 'low';
  dollarAmount?: number | null;
  customPrice?: number | null; // Precio personalizado si el usuario lo especificó
  customPriceDivisa?: number | null; // Precio divisa personalizado
}

interface ParseResponse {
  success: boolean;
  items: ParsedItem[];
  unmatched: string[];
  delivery?: number | null;
  customerName?: string | null;
  dollarsOnly?: boolean;
  isPaid?: boolean;
  pricingMode?: 'bcv' | 'divisa' | 'dual' | null;
  error?: string;
}

const categoryIcons: Record<string, string> = {
  'Camarones': '🦐',
  'Calamares': '🦑',
  'Mariscos': '🦀',
  'Especiales': '👑',
};

export default function AdminBudgetBuilder({ categories: initialCategories, bcvRate, editingPresupuesto, onEditComplete }: Props) {
  // Dynamic categories from API (refreshes on mount)
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);

  // Fetch fresh products from API on mount
  useEffect(() => {
    const fetchProducts = async () => {
      setIsLoadingProducts(true);
      try {
        const response = await fetch('/api/products');
        const data = await response.json();
        if (data.success && data.products) {
          // Group products by category
          const grouped = new Map<string, Product[]>();
          for (const p of data.products) {
            const nombre = p.nombre || '';
            const unidad = p.unidad || 'kg';
            const nombreLower = nombre.toLowerCase();
            const unidadLower = unidad.toLowerCase();

            // Compute derived fields (same logic as sheets.ts)
            const esCaja = nombreLower.includes('caja') || unidadLower === 'caja';

            // Determine incremento
            let incremento = 0.1;
            if (unidadLower === 'caja' || unidadLower === 'paquete' || unidadLower === 'bolsa') {
              incremento = 1;
            } else if (nombreLower.includes('tinta')) {
              incremento = 1;
            } else if (nombreLower.includes('guacuco')) {
              incremento = 0.01; // Permite cantidades precisas como 10.35kg
            }

            // Determine minimoKg
            let minimoKg: number | undefined = undefined;
            if (unidadLower !== 'caja' && unidadLower !== 'paquete' && unidadLower !== 'bolsa') {
              if (nombreLower.includes('pulpo grande')) minimoKg = 0.8;
              else if (nombreLower.includes('pulpo mediano')) minimoKg = 0.5;
              else if (nombreLower.includes('pulpo pequeño')) minimoKg = 0.3;
              else if (nombreLower.includes('salmon') || nombreLower.includes('salmón')) minimoKg = 0.2;
            }

            // Determine entradaLibre - allow free entry for most kg products
            let entradaLibre = true;
            if (unidadLower === 'caja' || unidadLower === 'paquete' || unidadLower === 'bolsa') {
              entradaLibre = false;
            } else if (nombreLower.includes('tinta')) {
              entradaLibre = false;
            }
            // Guacuco now allows free entry for precise quantities like 10.35kg

            const product: Product = {
              id: String(p.id),
              nombre,
              descripcion: p.descripcion || '',
              descripcionCorta: p.descripcionCorta || '',
              descripcionHome: p.descripcionHome || '',
              categoria: p.categoria,
              precioUSD: p.precioUSD,
              precioUSDDivisa: p.precioUSDDivisa ?? null,
              precioBs: p.precioUSD * bcvRate.rate,
              unidad,
              disponible: p.disponible,
              esCaja,
              incremento,
              minimoKg,
              entradaLibre,
            };
            if (!grouped.has(product.categoria)) {
              grouped.set(product.categoria, []);
            }
            grouped.get(product.categoria)!.push(product);
          }
          const newCategories: Category[] = Array.from(grouped.entries()).map(([name, products]) => ({
            name,
            products
          }));
          setCategories(newCategories);
        }
      } catch (err) {
        console.error('Error fetching products:', err);
        // Keep initial categories on error
      } finally {
        setIsLoadingProducts(false);
      }
    };
    fetchProducts();
  }, [bcvRate.rate]);

  // Fetch customers list for assignment dropdown
  useEffect(() => {
    const fetchCustomers = async () => {
      try {
        const response = await fetch('/api/customers', { credentials: 'include' });
        const data = await response.json();
        if (data.success && data.customers) {
          setCustomersList(data.customers.map((c: any) => ({ id: c.id, name: c.name })));
        }
      } catch (err) {
        // Silently fail - dropdown will be empty
      }
    };
    fetchCustomers();
  }, []);

  // Product selection state
  const [selectedItems, setSelectedItems] = useState<Map<string, AdminSelectedItem>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>(initialCategories[0]?.name || '');

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

  // Pricing mode: BCV or Divisa
  const [modoPrecio, setModoPrecio] = useState<'bcv' | 'divisa' | 'dual'>('bcv');

  // Mark as paid toggle
  const [markAsPaid, setMarkAsPaid] = useState(false);

  // Custom date for presupuesto
  const [useCustomDate, setUseCustomDate] = useState(false);
  const [customPresupuestoDate, setCustomPresupuestoDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  // Customer assignment for ledger
  const [customersList, setCustomersList] = useState<{id: number, name: string}[]>([]);
  const [assignToCustomer, setAssignToCustomer] = useState<number | null>(null);

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

  // Mobile summary panel expanded
  const [mobileSummaryExpanded, setMobileSummaryExpanded] = useState(false);

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
        const isCustomPriceDivisa = item.precioUSDDivisa != null && (
          !catalogProduct.precioUSDDivisa || Math.abs((catalogProduct.precioUSDDivisa || 0) - item.precioUSDDivisa) > 0.01
        );
        newItems.set(catalogProduct.id, {
          product: catalogProduct,
          quantity: item.cantidad,
          customPrice: isCustomPrice ? item.precioUSD : null,
          customPriceDivisa: isCustomPriceDivisa ? (item.precioUSDDivisa ?? null) : null,
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
          customPriceDivisa: item.precioUSDDivisa ?? null,
        });
      }
    }

    setSelectedItems(newItems);
    setPresupuestoId(editingPresupuesto.id);
    setCustomerName(editingPresupuesto.customerName || '');
    setCustomerAddress(editingPresupuesto.customerAddress || '');
    if (editingPresupuesto.estado === 'pagado') setMarkAsPaid(true);

    // Auto-detect pricing mode
    // Solo divisas: totalBs === 0 or items have precioBs === 0
    const isSoloDivisas = editingPresupuesto.totalBs === 0 ||
        editingPresupuesto.items.every(i => i.precioBs === 0);
    // Dual mode: has totalUSDDivisa or items have precioUSDDivisa
    const isDualMode = editingPresupuesto.totalUSDDivisa != null ||
        editingPresupuesto.items.some(i => i.precioUSDDivisa != null);

    if (isSoloDivisas) {
      setModoPrecio('divisa');
      setSoloDivisas(true);
    } else if (isDualMode) {
      setModoPrecio('dual');
    } else {
      setModoPrecio('bcv');
    }
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
    if (item.customPrice !== null) return item.customPrice;
    if (modoPrecio === 'divisa') {
      return item.product.precioUSDDivisa ?? item.product.precioUSD;
    }
    return item.product.precioUSD;
  };

  // Calculate totals
  const totals = useMemo(() => {
    let usd = 0;
    let usdDivisa = 0;
    selectedItems.forEach(item => {
      // Round each item subtotal to 2 decimals to avoid floating point accumulation
      usd += Math.round(getEffectivePrice(item) * item.quantity * 100) / 100;
      if (modoPrecio === 'dual') {
        const divisaPrice = item.customPriceDivisa !== null ? item.customPriceDivisa : (item.product.precioUSDDivisa ?? item.product.precioUSD);
        usdDivisa += Math.round(divisaPrice * item.quantity * 100) / 100;
      }
    });
    const usdWithDelivery = Math.round((usd + deliveryCost) * 100) / 100;
    const usdDivisaWithDelivery = modoPrecio === 'dual' ? Math.round((usdDivisa + deliveryCost) * 100) / 100 : undefined;
    return {
      subtotalUSD: usd,
      deliveryUSD: deliveryCost,
      totalUSD: usdWithDelivery,
      totalBs: Math.round(usdWithDelivery * bcvRate.rate * 100) / 100,
      totalUSDDivisa: usdDivisaWithDelivery,
    };
  }, [selectedItems, deliveryCost, bcvRate.rate, modoPrecio]);

  // Format helpers
  const formatUSD = (price: number) => `$${price.toFixed(2)}`;
  const formatBs = (price: number) => `Bs. ${price.toFixed(2)}`;

  const getDisplayPrice = (product: Product): number => {
    if (modoPrecio === 'divisa') {
      return product.precioUSDDivisa ?? product.precioUSD;
    }
    // 'bcv' and 'dual' both use BCV prices for main display
    return product.precioUSD;
  };
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
          customPriceDivisa: existing?.customPriceDivisa ?? null,
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
    const targetCents = Math.round(dollars * 100);
    let qty = Math.round((dollars / effectivePrice) * 10000) / 10000;
    if (qty <= 0) qty = 0.01;

    // Verify the subtotal rounds to the target dollar amount; adjust if needed
    if (Math.round(effectivePrice * qty * 100) !== targetCents) {
      // Try higher precision
      const qtyHigh = Math.round((dollars / effectivePrice) * 1000000) / 1000000;
      if (Math.round(effectivePrice * qtyHigh * 100) === targetCents) {
        qty = qtyHigh;
      } else {
        // Nudge qty down by one step to avoid rounding up
        const qtyDown = Math.floor((dollars / effectivePrice) * 10000) / 10000;
        if (qtyDown > 0 && Math.round(effectivePrice * qtyDown * 100) === targetCents) {
          qty = qtyDown;
        }
      }
    }

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
        precioUSDDivisa: p.precioUSDDivisa ?? null,
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
          // Usar precio personalizado del parser si existe, sino mantener el existente
          const newCustomPrice = item.customPrice ?? newItems.get(product.id)?.customPrice ?? null;
          const newCustomPriceDivisa = item.customPriceDivisa ?? newItems.get(product.id)?.customPriceDivisa ?? null;
          newItems.set(product.id, {
            product,
            quantity: existingQty + item.quantity,
            customPrice: newCustomPrice,
            customPriceDivisa: newCustomPriceDivisa,
          });
        }
      } else if (!item.matched && item.suggestedName && item.customPrice) {
        // Producto personalizado no en catálogo pero con precio
        const customId = `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const customProduct: Product = {
          id: customId,
          nombre: item.suggestedName,
          unidad: item.unit || 'kg',
          precioUSD: item.customPrice,
          precioUSDDivisa: item.customPriceDivisa ?? null,
          categoria: 'Otros',
          minimoKg: null,
          descripcion: null,
        };
        newItems.set(customId, {
          product: customProduct,
          quantity: item.quantity,
          customPrice: null, // Ya está en el producto
          customPriceDivisa: null,
        });
      }
    });

    setSelectedItems(newItems);

    // Aplicar delivery si el parser lo detectó
    if (parseResult.delivery && parseResult.delivery > 0) {
      setDeliveryCost(parseResult.delivery);
    }

    // Aplicar nombre del cliente si se detectó
    if (parseResult.customerName) {
      setCustomerName(parseResult.customerName);
    }

    // Aplicar solo divisas si se detectó
    if (parseResult.dollarsOnly) {
      setSoloDivisas(true);
    }

    // Aplicar marcar como pagado si se detectó
    if (parseResult.isPaid) {
      setMarkAsPaid(true);
    }

    // Aplicar modo de precio si se detectó
    if (parseResult.pricingMode === 'bcv') {
      setModoPrecio('bcv');
    } else if (parseResult.pricingMode === 'divisa') {
      setModoPrecio('divisa');
      setSoloDivisas(true);
    } else if (parseResult.pricingMode === 'dual') {
      setModoPrecio('dual');
    }

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
        precioUSDDivisa: p.precioUSDDivisa ?? null,
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

  // Generate note number - returns presupuesto ID if saved, "BORRADOR" if not
  const getDeliveryNoteNumber = () => {
    if (presupuestoId) return presupuestoId;
    return 'BORRADOR';
  };

  // Build items array for printing
  const buildPrintItems = () => {
    return Array.from(selectedItems.values()).map(item => {
      const base = {
        nombre: item.product.nombre,
        cantidad: item.quantity,
        unidad: item.product.unidad,
        precioUSD: getEffectivePrice(item),
        subtotalUSD: Math.round(getEffectivePrice(item) * item.quantity * 100) / 100,
      };
      if (modoPrecio === 'dual') {
        const divisaPrice = item.customPriceDivisa !== null ? item.customPriceDivisa : (item.product.precioUSDDivisa ?? item.product.precioUSD);
        return {
          ...base,
          precioUSDDivisa: divisaPrice,
          subtotalUSDDivisa: Math.round(divisaPrice * item.quantity * 100) / 100,
        };
      }
      return base;
    });
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
      ${modoPrecio === 'dual' ? '<div style="background:#e0f2fe;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;color:#075985;margin-bottom:4px;">PRECIOS BCV</div>' : ''}
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

  ${modoPrecio === 'dual' ? (() => {
    const divisaRows = items.map((item: any, i: number) => `
      <tr style="background:${i % 2 === 0 ? '#fff' : '#fefce8'}">
        <td style="border-right:1px solid #fde68a;padding:6px 10px;color:#713f12;">${item.nombre}</td>
        <td style="border-right:1px solid #fde68a;padding:6px 10px;text-align:center;color:#713f12;">${formatQuantity(item.cantidad)}</td>
        <td style="border-right:1px solid #fde68a;padding:6px 10px;text-align:center;color:#713f12;">${item.unidad}</td>
        <td style="border-right:1px solid #fde68a;padding:6px 10px;text-align:right;color:#713f12;">${formatUSD(item.precioUSDDivisa ?? item.precioUSD)}</td>
        <td style="padding:6px 10px;text-align:right;font-weight:600;color:#713f12;">${formatUSD(item.subtotalUSDDivisa ?? item.subtotalUSD)}</td>
      </tr>
    `).join('');
    const divisaDeliveryRow = deliveryCost > 0 ? `
      <tr style="background:#fffbeb;">
        <td style="border-right:1px solid #fde68a;padding:6px 10px;color:#713f12;font-style:italic;">Delivery</td>
        <td style="border-right:1px solid #fde68a;padding:6px 10px;text-align:center;color:#713f12;">1</td>
        <td style="border-right:1px solid #fde68a;padding:6px 10px;text-align:center;color:#713f12;">servicio</td>
        <td style="border-right:1px solid #fde68a;padding:6px 10px;text-align:right;color:#713f12;">${formatUSD(deliveryCost)}</td>
        <td style="padding:6px 10px;text-align:right;font-weight:600;color:#713f12;">${formatUSD(deliveryCost)}</td>
      </tr>
    ` : '';
    return `
  <div style="page-break-before:always;"></div>

  <div class="watermark" style="color:rgba(234,179,8,0.06);">PRESUPUESTO</div>

  ${markAsPaid ? `
  <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-15deg);border:6px solid #16a34a;border-radius:12px;padding:15px 40px;color:#16a34a;font-size:36px;font-weight:900;text-transform:uppercase;letter-spacing:3px;opacity:0.35;pointer-events:none;z-index:1;">
    PAGADO
  </div>
  ` : ''}

  <div style="display:flex;align-items:center;justify-content:space-between;border:2px solid #92400e;padding:12px 16px;margin-bottom:16px;">
    <div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
        <div style="width:48px;height:48px;border-radius:50%;border:2px solid #fde68a;overflow:hidden;flex-shrink:0;background:white;display:flex;align-items:center;justify-content:center;">
          <img src="/camaronlogo-sm.webp" alt="RPYM" style="width:140%;height:140%;object-fit:contain;" />
        </div>
        <div style="font-size:22px;font-weight:800;color:#713f12;">RPYM</div>
      </div>
      <div style="font-size:10px;color:#92400e;">Muelle Pesquero "El Mosquero", Puesto 3 y 4, Maiquetia</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:16px;font-weight:700;color:#713f12;border-bottom:2px solid #92400e;padding-bottom:4px;margin-bottom:6px;">PRESUPUESTO</div>
      <div style="background:#fef3c7;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;color:#92400e;margin-bottom:4px;">PRECIOS DIVISA</div>
      <div style="font-size:10px;color:#92400e;">No: <span style="font-family:monospace;font-weight:600;color:#713f12;">${noteNumber}</span></div>
      <div style="font-size:10px;color:#92400e;margin-top:2px;">Fecha: <span style="font-weight:600;color:#713f12;">${date}</span></div>
    </div>
  </div>

  <div style="border:2px solid #92400e;padding:10px 16px;margin-bottom:16px;">
    <div style="margin-bottom:6px;">
      <span style="font-size:10px;font-weight:600;color:#92400e;">Cliente:</span>
      <span style="font-size:12px;color:#713f12;margin-left:8px;">${customerName || '---'}</span>
    </div>
    <div>
      <span style="font-size:10px;font-weight:600;color:#92400e;">Direccion:</span>
      <span style="font-size:12px;color:#713f12;margin-left:8px;">${customerAddress || '---'}</span>
    </div>
  </div>

  <div style="border:2px solid #92400e;margin-bottom:16px;">
    <table>
      <thead>
        <tr style="background:#fef3c7;">
          <th style="border-bottom:2px solid #92400e;border-right:1px solid #92400e;padding:8px 10px;text-align:left;font-size:11px;font-weight:700;color:#713f12;">Producto</th>
          <th style="border-bottom:2px solid #92400e;border-right:1px solid #92400e;padding:8px 10px;text-align:center;font-size:11px;font-weight:700;color:#713f12;width:60px;">Cant</th>
          <th style="border-bottom:2px solid #92400e;border-right:1px solid #92400e;padding:8px 10px;text-align:center;font-size:11px;font-weight:700;color:#713f12;width:60px;">Unidad</th>
          <th style="border-bottom:2px solid #92400e;border-right:1px solid #92400e;padding:8px 10px;text-align:right;font-size:11px;font-weight:700;color:#713f12;width:80px;">P.Unitario</th>
          <th style="border-bottom:2px solid #92400e;padding:8px 10px;text-align:right;font-size:11px;font-weight:700;color:#713f12;width:80px;">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${divisaRows}
        ${divisaDeliveryRow}
      </tbody>
    </table>
  </div>

  <div style="border:2px solid #92400e;margin-bottom:16px;display:flex;">
    <div style="flex:1;padding:10px 16px;border-right:2px solid #92400e;">
      <div style="font-size:10px;font-weight:600;color:#92400e;margin-bottom:4px;">OBSERVACIONES:</div>
      <div style="font-size:10px;color:#92400e;">Precios en USD (Divisa)</div>
    </div>
    <div style="width:200px;padding:10px 16px;">
      ${deliveryCost > 0 ? `
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px;">
        <span style="color:#92400e;">Subtotal:</span>
        <span style="font-weight:600;color:#713f12;">${formatUSD(totals.totalUSDDivisa! - deliveryCost)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:6px;">
        <span style="color:#92400e;">Delivery:</span>
        <span style="font-weight:600;color:#713f12;">${formatUSD(deliveryCost)}</span>
      </div>
      ` : ''}
      <div style="display:flex;justify-content:space-between;font-size:13px;${deliveryCost > 0 ? 'border-top:1px solid #fde68a;padding-top:6px;' : ''}">
        <span style="color:#92400e;font-weight:600;">Total USD:</span>
        <span style="font-weight:800;color:#713f12;">${formatUSD(totals.totalUSDDivisa!)}</span>
      </div>
    </div>
  </div>

  <div style="display:flex;gap:40px;margin-top:40px;">
    <div style="flex:1;text-align:center;">
      <div style="border-top:2px solid #92400e;padding-top:6px;margin:0 30px;">
        <span style="font-size:10px;font-weight:600;color:#92400e;">CONFORME CLIENTE</span>
      </div>
    </div>
    <div style="flex:1;text-align:center;">
      <div style="border-top:2px solid #92400e;padding-top:6px;margin:0 30px;">
        <span style="font-size:10px;font-weight:600;color:#92400e;">ENTREGADO POR</span>
      </div>
    </div>
  </div>

  ${markAsPaid ? `
  <div style="background:#dcfce7;color:#166534;padding:12px;border-radius:8px;text-align:center;margin-top:16px;font-weight:600;font-size:13px;">
    Gracias por su compra!
  </div>
  ` : ''}

  <div style="margin-top:${markAsPaid ? '8' : '20'}px;padding:6px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:4px;text-align:center;">
    <span style="font-size:10px;color:#b45309;font-weight:500;">Este documento no tiene validez fiscal - Solo para referencia</span>
  </div>

  <div style="margin-top:12px;padding-top:8px;border-top:1px solid #fde68a;text-align:center;">
    <span style="font-size:10px;color:#d97706;">www.rpym.net &bull; WhatsApp: +58 414-214-5202</span>
  </div>`;
  })() : ''}
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
      flex-direction: column;
      align-items: center;
      padding: 16px 0;
    }
  </style>
</head>
<body>
  <div style="width:320px;background:white;border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <!-- Logo -->
    <div style="text-align:center;margin-bottom:12px;">
      <img src="/camaronlogo-sm.webp" alt="RPYM" style="display:block;width:140px;height:auto;object-fit:contain;margin:0 auto;" />
      <div style="font-size:12px;color:#0369a1;margin-top:4px;">Presupuesto</div>
      ${modoPrecio === 'dual' ? '<div style="background:#e0f2fe;display:inline-block;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;color:#075985;margin-top:4px;">Precios BCV</div>' : ''}
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

  ${modoPrecio === 'dual' ? (() => {
    const divisaProductRows = items.map((item: any) => `
      <div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;border-bottom:1px solid #fefce8;">
        <div style="flex:1;font-size:13px;color:#713f12;">${item.nombre}</div>
        <div style="font-size:12px;color:#92400e;margin:0 8px;white-space:nowrap;">${formatQuantity(item.cantidad)} ${item.unidad}</div>
        <div style="font-size:13px;font-weight:600;color:#713f12;white-space:nowrap;">${formatUSD(item.subtotalUSDDivisa ?? item.subtotalUSD)}</div>
      </div>
    `).join('');
    const divisaDelivery = deliveryCost > 0 ? `
      <div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;border-bottom:1px solid #fefce8;">
        <div style="flex:1;font-size:13px;color:#713f12;font-style:italic;">Delivery</div>
        <div style="font-size:13px;font-weight:600;color:#713f12;white-space:nowrap;">${formatUSD(deliveryCost)}</div>
      </div>
    ` : '';
    return `
  <div style="width:320px;background:white;border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.08);margin-top:16px;border:2px solid #fde68a;">
    <div style="text-align:center;margin-bottom:12px;">
      <img src="/camaronlogo-sm.webp" alt="RPYM" style="display:block;width:140px;height:auto;object-fit:contain;margin:0 auto;" />
      <div style="background:#fef3c7;display:inline-block;padding:3px 12px;border-radius:6px;font-size:12px;font-weight:700;color:#92400e;margin-top:4px;">Precios Divisa</div>
      ${markAsPaid ? '<div style="display:inline-flex;align-items:center;gap:4px;background:#dcfce7;color:#166534;font-size:12px;font-weight:600;padding:3px 10px;border-radius:9999px;margin-top:6px;">PAGADO</div>' : ''}
    </div>
    ${customerName ? '<div style="font-size:12px;color:#92400e;text-align:center;margin-bottom:10px;">Cliente: <strong style="color:#713f12;">' + customerName + '</strong></div>' : ''}
    <div style="margin-bottom:12px;">
      ${divisaProductRows}
      ${divisaDelivery}
    </div>
    <div style="border-top:2px solid #92400e;padding-top:10px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="font-size:14px;font-weight:600;color:#92400e;">Total USD (Divisa)</span>
        <span style="font-size:20px;font-weight:800;color:#713f12;">${formatUSD(totals.totalUSDDivisa!)}</span>
      </div>
    </div>
    <div style="text-align:center;border-top:1px solid #fde68a;padding-top:8px;">
      <div style="font-size:10px;color:#d97706;">${date}</div>
      <div style="font-size:10px;color:#d97706;margin-top:2px;">WhatsApp: +58 414-214-5202</div>
      <div style="font-size:9px;color:#fde68a;margin-top:4px;">Ref: ${noteNumber}</div>
    </div>
  </div>`;
  })() : ''}
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
      const items = Array.from(selectedItems.values()).map(item => {
        // If soloDivisas is true, don't include Bs prices (set to 0)
        const includeBs = !soloDivisas;
        const base = {
          nombre: item.product.nombre,
          cantidad: item.quantity,
          unidad: item.product.unidad,
          precioUSD: getEffectivePrice(item),
          precioBs: includeBs ? Math.round(getEffectivePrice(item) * bcvRate.rate * 100) / 100 : 0,
          subtotalUSD: Math.round(getEffectivePrice(item) * item.quantity * 100) / 100,
          subtotalBs: includeBs ? Math.round(getEffectivePrice(item) * item.quantity * bcvRate.rate * 100) / 100 : 0,
        };
        if (modoPrecio === 'dual') {
          const divisaPrice = item.customPriceDivisa !== null ? item.customPriceDivisa : (item.product.precioUSDDivisa ?? item.product.precioUSD);
          return {
            ...base,
            precioUSDDivisa: divisaPrice,
            subtotalUSDDivisa: Math.round(divisaPrice * item.quantity * 100) / 100,
          };
        }
        return base;
      });

      let result;

      if (editingPresupuesto) {
        // Update existing presupuesto
        const updated = await updatePresupuesto(
          editingPresupuesto.id,
          items,
          totals.totalUSD,
          soloDivisas ? 0 : totals.totalBs,
          customerName,
          customerAddress,
          modoPrecio === 'dual' ? totals.totalUSDDivisa : undefined,
        );
        if (updated) {
          setSaveMessage(`Actualizado: ${editingPresupuesto.id}`);
          onEditComplete?.();
        } else {
          setSaveMessage('Error al actualizar. Intenta de nuevo.');
        }
      } else {
        result = await savePresupuesto({
          items,
          totalUSD: totals.totalUSD,
          totalBs: soloDivisas ? 0 : totals.totalBs,
          totalUSDDivisa: modoPrecio === 'dual' ? totals.totalUSDDivisa : undefined,
          customerName,
          customerAddress,
          status: markAsPaid ? 'pagado' : 'pendiente',
          source: 'admin',
          customDate: useCustomDate ? customPresupuestoDate : undefined,
        });
        if (result.success && result.id) {
          setPresupuestoId(result.id);
          setSaveMessage(`Guardado con ID: ${result.id}`);

          // If assigned to a customer, create a transaction in their ledger
          if (assignToCustomer) {
            const txDate = useCustomDate ? customPresupuestoDate : new Date().toISOString().split('T')[0];
            try {
              await fetch(`/api/customers/${assignToCustomer}/transactions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                  type: 'purchase',
                  date: txDate,
                  description: `Presupuesto ${result.id}`,
                  amountUsd: totals.totalUSD,
                  amountBs: totals.totalBs,
                  presupuestoId: result.id,
                })
              });
            } catch (err) {
              console.error('Error assigning to customer:', err);
            }
          }
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
        {/* Pricing mode toggle */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-ocean-100">
          <span className="text-xs text-ocean-600 mr-1">Modo:</span>
          <div className="flex rounded-lg overflow-hidden border border-ocean-200">
            <button
              onClick={() => { setModoPrecio('bcv'); setSoloDivisas(false); }}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                modoPrecio === 'bcv'
                  ? 'bg-ocean-600 text-white'
                  : 'bg-white text-ocean-600 hover:bg-ocean-50'
              }`}
            >
              BCV
            </button>
            <button
              onClick={() => { setModoPrecio('dual'); setSoloDivisas(false); }}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                modoPrecio === 'dual'
                  ? 'bg-purple-600 text-white'
                  : 'bg-white text-ocean-600 hover:bg-ocean-50'
              }`}
            >
              Dual
            </button>
            <button
              onClick={() => { setModoPrecio('divisa'); setSoloDivisas(true); }}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                modoPrecio === 'divisa'
                  ? 'bg-green-600 text-white'
                  : 'bg-white text-ocean-600 hover:bg-ocean-50'
              }`}
            >
              Divisa
            </button>
          </div>
        </div>
        {/* Custom date toggle */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-ocean-100">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useCustomDate}
              onChange={(e) => setUseCustomDate(e.target.checked)}
              className="rounded border-ocean-300 text-ocean-600 focus:ring-ocean-500"
            />
            <span className="text-xs text-ocean-600">Fecha personalizada</span>
          </label>
          {useCustomDate && (
            <input
              type="date"
              value={customPresupuestoDate}
              onChange={(e) => setCustomPresupuestoDate(e.target.value)}
              className="ml-2 px-2 py-1 text-xs border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
            />
          )}
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
                {parseResult.items.map((item, index) => {
                  // Determine item type: matched, custom (unmatched with price), or unmatched
                  const isCustomProduct = !item.matched && item.suggestedName && item.customPrice;
                  const bgClass = item.matched
                    ? 'bg-green-50 border-green-200'
                    : isCustomProduct
                      ? 'bg-purple-50 border-purple-200'
                      : 'bg-orange-50 border-orange-200';

                  return (
                  <div
                    key={index}
                    className={`p-3 rounded-xl border ${bgClass}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          {item.matched ? (
                            <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : isCustomProduct ? (
                            <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                          )}
                          <span className="font-medium text-ocean-900 text-sm">
                            {item.matched ? item.productName : isCustomProduct ? item.suggestedName : item.requestedName}
                          </span>
                          {isCustomProduct && (
                            <span className="text-[10px] bg-purple-200 text-purple-700 px-1.5 py-0.5 rounded font-medium">Nuevo</span>
                          )}
                        </div>
                        {item.matched && item.requestedName !== item.productName && (
                          <p className="text-xs text-ocean-500 mt-0.5 ml-6">Pedido: "{item.requestedName}"</p>
                        )}
                        {isCustomProduct && (
                          <p className="text-xs text-purple-600 mt-1 ml-6">Producto personalizado (se creara)</p>
                        )}
                        {!item.matched && !isCustomProduct && (
                          <p className="text-xs text-orange-700 mt-1 ml-6">No encontrado en el catalogo</p>
                        )}
                      </div>
                      <div className="flex items-start gap-2">
                        <div className="text-right">
                          <span className="text-sm font-semibold text-ocean-900">
                            {item.quantity.toFixed(2)} {item.unit}
                          </span>
                          {item.dollarAmount && (
                            <span className="block text-xs text-purple-600 font-medium">
                              (de ${item.dollarAmount})
                            </span>
                          )}
                          {item.matched && item.productId && (
                            <>
                              <span className="block text-xs text-coral-600 font-medium">
                                {formatUSD(
                                  Math.round((item.customPrice || allProducts.find(p => String(p.id) === String(item.productId))?.precioUSD || 0) * item.quantity * 100) / 100
                                )}
                              </span>
                              {item.customPrice && (
                                <span className="block text-xs text-green-600 font-medium">
                                  precio: ${item.customPrice}/{item.unit}
                                </span>
                              )}
                            </>
                          )}
                          {isCustomProduct && item.customPrice && (
                            <>
                              <span className="block text-xs text-coral-600 font-medium">
                                {formatUSD(Math.round(item.customPrice * item.quantity * 100) / 100)}
                              </span>
                              <span className="block text-xs text-purple-600 font-medium">
                                ${item.customPrice}/{item.unit}
                              </span>
                            </>
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
                )})}
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

              {/* Delivery detected */}
              {parseResult.delivery && parseResult.delivery > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    <span className="text-amber-800 font-medium">Delivery detectado</span>
                  </div>
                  <span className="text-amber-700 font-bold">{formatUSD(parseResult.delivery)}</span>
                </div>
              )}

              {/* Detected order info */}
              {(parseResult.customerName || parseResult.dollarsOnly || parseResult.isPaid) && (
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 text-purple-800 font-medium text-sm">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Info detectada del pedido
                  </div>
                  {parseResult.customerName && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-purple-700">Cliente:</span>
                      <span className="font-medium text-purple-900">{parseResult.customerName}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {parseResult.dollarsOnly && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Solo dolares
                      </span>
                    )}
                    {parseResult.isPaid && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Pagado
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Estimated total */}
              {parseResult.items.some(i => i.matched || (i.suggestedName && i.customPrice)) && (
                <div className="p-4 bg-ocean-50 rounded-xl space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-ocean-700">Subtotal productos:</span>
                    <span className="text-lg font-semibold text-ocean-800">
                      {formatUSD(
                        parseResult.items
                          .filter(i => (i.matched && i.productId) || (i.suggestedName && i.customPrice))
                          .reduce((sum, item) => {
                            if (item.matched && item.productId) {
                              const product = allProducts.find(p => String(p.id) === String(item.productId));
                              return sum + Math.round((item.customPrice || product?.precioUSD || 0) * item.quantity * 100) / 100;
                            } else if (item.suggestedName && item.customPrice) {
                              return sum + Math.round(item.customPrice * item.quantity * 100) / 100;
                            }
                            return sum;
                          }, 0)
                      )}
                    </span>
                  </div>
                  {parseResult.delivery && parseResult.delivery > 0 && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-ocean-600">+ Delivery:</span>
                      <span className="text-ocean-700">{formatUSD(parseResult.delivery)}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center pt-2 border-t border-ocean-200">
                    <span className="text-ocean-700 font-medium">Total estimado:</span>
                    <span className="text-2xl font-bold text-coral-500">
                      {formatUSD(
                        parseResult.items
                          .filter(i => (i.matched && i.productId) || (i.suggestedName && i.customPrice))
                          .reduce((sum, item) => {
                            if (item.matched && item.productId) {
                              const product = allProducts.find(p => String(p.id) === String(item.productId));
                              return sum + Math.round((item.customPrice || product?.precioUSD || 0) * item.quantity * 100) / 100;
                            } else if (item.suggestedName && item.customPrice) {
                              return sum + Math.round(item.customPrice * item.quantity * 100) / 100;
                            }
                            return sum;
                          }, 0) + (parseResult.delivery || 0)
                      )}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={clearParsing}
                  className="py-3 px-4 border border-ocean-300 text-ocean-700 font-medium rounded-xl
                    hover:bg-ocean-100 transition-colors text-sm"
                >
                  Cancelar
                </button>
                <button
                  onClick={applyParsedItems}
                  disabled={!parseResult.items.some(i => i.matched || (i.suggestedName && i.customPrice))}
                  className="flex-1 py-3 px-4 bg-coral-500 hover:bg-coral-600 disabled:bg-ocean-200 disabled:text-ocean-400
                    text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-md"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Agregar al Presupuesto
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main content: product selection + summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pb-24 lg:pb-0">
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
                              <span className="text-coral-500 font-bold text-sm">{formatUSD(getDisplayPrice(product))}</span>
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
                                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
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
                                    {formatUSD(getDisplayPrice(product))}
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
                                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
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
                                = {formatUSD(Math.round(getEffectivePrice(selectedItems.get(product.id)!) * quantity * 100) / 100)}
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

        {/* Summary panel - hidden on mobile, shown on desktop */}
        <div className={`hidden lg:block ${inputMode === 'manual' ? 'lg:col-span-1' : 'lg:col-span-3'}`}>
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
                                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
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
                    <span className="text-sm text-ocean-600">{modoPrecio === 'dual' ? 'Total BCV' : 'Total USD'}</span>
                    <span className="text-2xl font-bold text-coral-500">{formatUSD(totals.totalUSD)}</span>
                  </div>
                  {modoPrecio === 'dual' && totals.totalUSDDivisa !== undefined && (
                    <div className="flex justify-between items-center border-l-2 border-purple-400 pl-2">
                      <span className="text-sm text-purple-600">Total Divisa</span>
                      <span className="text-xl font-bold text-purple-600">{formatUSD(totals.totalUSDDivisa)}</span>
                    </div>
                  )}
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

      {/* Mobile floating summary bar */}
      {inputMode === 'manual' && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40">
          {/* Expanded mobile summary */}
          {mobileSummaryExpanded && (
            <div className="bg-white border-t border-ocean-200 shadow-2xl max-h-[70vh] overflow-y-auto">
              <div className="p-4 space-y-3">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-ocean-900">Resumen ({selectedItems.size} items)</h3>
                  <button
                    onClick={() => setMobileSummaryExpanded(false)}
                    className="p-1 text-ocean-500 hover:text-ocean-700"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>

                {/* Customer info */}
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Nombre cliente"
                    className="w-full px-3 py-2 text-sm border border-ocean-200 rounded-lg outline-none focus:ring-1 focus:ring-ocean-500"
                  />
                  <input
                    type="text"
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    placeholder="Dirección"
                    className="w-full px-3 py-2 text-sm border border-ocean-200 rounded-lg outline-none focus:ring-1 focus:ring-ocean-500"
                  />
                </div>

                {/* Items list */}
                {selectedItems.size > 0 && (
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {Array.from(selectedItems.values()).map((item) => {
                      const effectivePrice = getEffectivePrice(item);
                      return (
                        <div key={item.product.id} className="flex items-center justify-between text-sm bg-ocean-50 rounded-lg px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <span className="text-ocean-800 truncate block">{item.product.nombre}</span>
                            <span className="text-ocean-500 text-xs">{formatQuantity(item.quantity)} {item.product.unidad}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-coral-500">{formatUSD(effectivePrice * item.quantity)}</span>
                            <button
                              onClick={() => updateQuantity(item.product, 0)}
                              className="w-5 h-5 rounded-full bg-red-100 text-red-600 flex items-center justify-center"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Custom product (mobile) */}
                {!showCustomForm ? (
                  <button
                    onClick={() => setShowCustomForm(true)}
                    className="w-full py-2 border-2 border-dashed border-ocean-200 text-ocean-500 hover:border-ocean-400 hover:text-ocean-700 rounded-lg text-sm transition-colors flex items-center justify-center gap-1.5"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Producto personalizado
                  </button>
                ) : (
                  <div className="p-3 border border-ocean-200 rounded-lg space-y-2 bg-ocean-50">
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

                {/* Delivery */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-ocean-600">Delivery:</span>
                  <div className="relative flex-1">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ocean-400">$</span>
                    <input
                      type="number"
                      value={deliveryCost || ''}
                      onChange={(e) => setDeliveryCost(parseFloat(e.target.value) || 0)}
                      placeholder="0"
                      step="0.5"
                      min="0"
                      className="w-full pl-5 pr-2 py-1.5 text-sm border border-ocean-200 rounded-lg outline-none focus:ring-1 focus:ring-ocean-500
                        [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                </div>

                {/* Toggles */}
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-xs text-ocean-600">
                    <input
                      type="checkbox"
                      checked={soloDivisas}
                      onChange={(e) => setSoloDivisas(e.target.checked)}
                      className="rounded border-ocean-300"
                    />
                    Solo divisas
                  </label>
                  <label className="flex items-center gap-2 text-xs text-ocean-600">
                    <input
                      type="checkbox"
                      checked={markAsPaid}
                      onChange={(e) => setMarkAsPaid(e.target.checked)}
                      className="rounded border-ocean-300"
                    />
                    Pagado
                  </label>
                </div>

                {/* Assign to customer */}
                {customersList.length > 0 && (
                  <div>
                    <label className="text-xs font-medium text-ocean-600 block mb-1">Asignar a cuenta de cliente</label>
                    <select
                      value={assignToCustomer || ''}
                      onChange={(e) => setAssignToCustomer(e.target.value ? parseInt(e.target.value) : null)}
                      className="w-full px-3 py-2 text-sm border border-ocean-200 rounded-lg outline-none focus:ring-1 focus:ring-ocean-500 bg-white"
                    >
                      <option value="">-- No asignar --</option>
                      {customersList.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Total */}
                <div className={`border-t pt-3 ${modoPrecio === 'dual' ? 'border-purple-300' : 'border-ocean-200'}`}>
                  <div className="flex justify-between items-center text-lg">
                    <span className="font-semibold text-ocean-800">{modoPrecio === 'dual' ? 'Total BCV:' : 'Total:'}</span>
                    <span className="font-bold text-coral-500">{formatUSD(totals.totalUSD)}</span>
                  </div>
                  {modoPrecio === 'dual' && totals.totalUSDDivisa !== undefined && (
                    <div className="flex justify-between items-center text-lg mt-1 border-l-2 border-purple-400 pl-2">
                      <span className="font-semibold text-purple-700">Total Divisa:</span>
                      <span className="font-bold text-purple-600">{formatUSD(totals.totalUSDDivisa)}</span>
                    </div>
                  )}
                  {!soloDivisas && (
                    <div className="flex justify-between items-center text-sm text-ocean-600 mt-1">
                      <span>En Bs.:</span>
                      <span>Bs. {totals.totalBs.toFixed(2)}</span>
                    </div>
                  )}
                </div>

                {/* Print/WhatsApp buttons */}
                {selectedItems.size > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={printCarta}
                      className="py-2 text-xs bg-ocean-100 text-ocean-700 rounded-lg flex items-center justify-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                      </svg>
                      Imprimir
                    </button>
                    <button
                      onClick={openWhatsAppView}
                      className="py-2 text-xs bg-green-100 text-green-700 rounded-lg flex items-center justify-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      WhatsApp
                    </button>
                  </div>
                )}

                {/* Action buttons */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={clearSelection}
                    disabled={selectedItems.size === 0}
                    className="py-2.5 text-sm text-ocean-600 border border-ocean-200 rounded-lg disabled:opacity-50"
                  >
                    Limpiar
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={selectedItems.size === 0 || isSaving}
                    className="py-2.5 text-sm bg-coral-500 text-white font-semibold rounded-lg disabled:opacity-50"
                  >
                    {isSaving ? 'Guardando...' : editingPresupuesto ? 'Actualizar' : 'Guardar'}
                  </button>
                </div>

                {/* Save message */}
                {saveMessage && (
                  <p className={`text-xs text-center ${saveMessage.includes('Error') ? 'text-red-600' : 'text-green-600'}`}>
                    {saveMessage}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Collapsed mobile summary bar */}
          <div
            onClick={() => setMobileSummaryExpanded(!mobileSummaryExpanded)}
            className="bg-white border-t border-ocean-200 shadow-lg px-4 py-3 flex items-center justify-between cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-coral-100 text-coral-600 flex items-center justify-center font-bold text-sm">
                {selectedItems.size}
              </div>
              <div>
                <p className="text-xs text-ocean-500">
                  {selectedItems.size === 0 ? 'Sin productos' : `${selectedItems.size} producto${selectedItems.size > 1 ? 's' : ''}`}
                </p>
                <p className="font-bold text-ocean-900">{formatUSD(totals.totalUSD)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {selectedItems.size > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSave();
                  }}
                  disabled={isSaving}
                  className="px-4 py-2 bg-coral-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
                >
                  {isSaving ? '...' : 'Guardar'}
                </button>
              )}
              <svg
                className={`w-5 h-5 text-ocean-400 transition-transform ${mobileSummaryExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
