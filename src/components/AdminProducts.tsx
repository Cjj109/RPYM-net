/**
 * RPYM - Admin Products Management
 * Gestión de productos desde D1 database
 */
import { useState, useEffect, useCallback } from 'react';

interface Product {
  id: number;
  nombre: string;
  descripcion: string;
  descripcionCorta: string;
  descripcionHome: string;
  categoria: string;
  precioUSD: number;
  precioUSDDivisa: number | null;
  unidad: string;
  disponible: boolean;
  sortOrder: number;
}

interface AdminProductsProps {
  onProductsChange?: () => void;
}

export default function AdminProducts({ onProductsChange }: AdminProductsProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Estado para el modal de crear/editar
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Estado del formulario
  const [formData, setFormData] = useState({
    nombre: '',
    descripcion: '',
    descripcionCorta: '',
    descripcionHome: '',
    categoria: '',
    precioUSD: '',
    precioUSDDivisa: '',
    unidad: 'kg',
    disponible: true
  });

  // Estado para importación
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  // Estado para filtros
  const [filterCategoria, setFilterCategoria] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Categorías disponibles
  const categorias = [...new Set(products.map(p => p.categoria))].sort();

  // Cargar productos
  const loadProducts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/products');
      const data = await response.json();

      if (data.success) {
        setProducts(data.products);
      } else {
        setError(data.error || 'Error al cargar productos');
      }
    } catch (err) {
      setError('Error de conexión');
      console.error('Error loading products:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  // Filtrar productos
  const filteredProducts = products.filter(p => {
    const matchesCategoria = filterCategoria === 'all' || p.categoria === filterCategoria;
    const matchesSearch = !searchTerm ||
      p.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.descripcion?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategoria && matchesSearch;
  });

  // Abrir modal para nuevo producto
  const handleNewProduct = () => {
    setEditingProduct(null);
    setFormData({
      nombre: '',
      descripcion: '',
      descripcionCorta: '',
      descripcionHome: '',
      categoria: categorias[0] || 'Pescados',
      precioUSD: '',
      precioUSDDivisa: '',
      unidad: 'kg',
      disponible: true
    });
    setShowModal(true);
  };

  // Abrir modal para editar
  const handleEditProduct = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      nombre: product.nombre,
      descripcion: product.descripcion || '',
      descripcionCorta: product.descripcionCorta || '',
      descripcionHome: product.descripcionHome || '',
      categoria: product.categoria,
      precioUSD: String(product.precioUSD),
      precioUSDDivisa: product.precioUSDDivisa != null ? String(product.precioUSDDivisa) : '',
      unidad: product.unidad,
      disponible: product.disponible
    });
    setShowModal(true);
  };

  // Guardar producto
  const handleSaveProduct = async () => {
    if (!formData.nombre || !formData.precioUSD || !formData.categoria) {
      alert('Completa todos los campos requeridos');
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        nombre: formData.nombre.trim(),
        descripcion: formData.descripcion.trim() || null,
        descripcionCorta: formData.descripcionCorta.trim() || null,
        descripcionHome: formData.descripcionHome.trim() || null,
        categoria: formData.categoria,
        precioUSD: parseFloat(formData.precioUSD),
        precioUSDDivisa: formData.precioUSDDivisa ? parseFloat(formData.precioUSDDivisa) : null,
        unidad: formData.unidad,
        disponible: formData.disponible
      };

      let response;
      if (editingProduct) {
        // Actualizar
        response = await fetch(`/api/products/${editingProduct.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          credentials: 'include'
        });
      } else {
        // Crear nuevo
        response = await fetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          credentials: 'include'
        });
      }

      const data = await response.json();

      if (data.success) {
        setShowModal(false);
        loadProducts();
        onProductsChange?.();
      } else {
        alert(data.error || 'Error al guardar');
      }
    } catch (err) {
      console.error('Error saving product:', err);
      alert('Error al guardar el producto');
    } finally {
      setIsSaving(false);
    }
  };

  // Eliminar producto
  const handleDeleteProduct = async (product: Product) => {
    if (!confirm(`¿Eliminar "${product.nombre}"? Esta acción no se puede deshacer.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/products/${product.id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      const data = await response.json();

      if (data.success) {
        loadProducts();
        onProductsChange?.();
      } else {
        alert(data.error || 'Error al eliminar');
      }
    } catch (err) {
      console.error('Error deleting product:', err);
      alert('Error al eliminar el producto');
    }
  };

  // Toggle disponibilidad
  const handleToggleDisponible = async (product: Product) => {
    try {
      const response = await fetch(`/api/products/${product.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disponible: !product.disponible }),
        credentials: 'include'
      });

      const data = await response.json();

      if (data.success) {
        loadProducts();
        onProductsChange?.();
      } else {
        alert(data.error || 'Error al actualizar');
      }
    } catch (err) {
      console.error('Error toggling disponible:', err);
    }
  };

  // Importar desde Google Sheet
  const handleImportFromSheet = async () => {
    if (!confirm('¿Importar productos desde Google Sheet? Esto solo funciona si la base de datos D1 está vacía.')) {
      return;
    }

    setIsImporting(true);
    setImportStatus('Importando...');

    try {
      const response = await fetch('/api/products/import', {
        method: 'POST',
        credentials: 'include'
      });

      const data = await response.json();

      if (data.success) {
        setImportStatus(`Importados ${data.count} productos`);
        loadProducts();
        onProductsChange?.();
      } else {
        setImportStatus(`Error: ${data.error}`);
      }
    } catch (err) {
      console.error('Error importing:', err);
      setImportStatus('Error de conexión');
    } finally {
      setIsImporting(false);
      setTimeout(() => setImportStatus(null), 5000);
    }
  };

  // Limpiar productos (para reimportar)
  const handleClearProducts = async () => {
    if (!confirm('¿ELIMINAR TODOS los productos? Esta acción no se puede deshacer.')) {
      return;
    }
    if (!confirm('¿Estás SEGURO? Se eliminarán TODOS los productos de la base de datos.')) {
      return;
    }

    setIsImporting(true);
    setImportStatus('Eliminando...');

    try {
      const response = await fetch('/api/products/import', {
        method: 'DELETE',
        credentials: 'include'
      });

      const data = await response.json();

      if (data.success) {
        setImportStatus('Productos eliminados');
        loadProducts();
        onProductsChange?.();
      } else {
        setImportStatus(`Error: ${data.error}`);
      }
    } catch (err) {
      console.error('Error clearing:', err);
      setImportStatus('Error de conexión');
    } finally {
      setIsImporting(false);
      setTimeout(() => setImportStatus(null), 5000);
    }
  };

  const formatUSD = (amount: number) => `$${Number(amount).toFixed(2)}`;

  return (
    <div className="space-y-6">
      {/* Header con acciones */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-ocean-100">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-ocean-900">Gestión de Productos</h2>
            <p className="text-sm text-ocean-600">
              {products.length} productos en la base de datos
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleNewProduct}
              className="px-4 py-2 bg-ocean-600 hover:bg-ocean-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Nuevo Producto
            </button>

            <button
              onClick={handleImportFromSheet}
              disabled={isImporting}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-green-300 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Importar Sheet
            </button>

            <button
              onClick={handleClearProducts}
              disabled={isImporting || products.length === 0}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-red-300 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Limpiar Todo
            </button>
          </div>
        </div>

        {importStatus && (
          <div className={`mt-3 p-2 rounded-lg text-sm ${
            importStatus.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
          }`}>
            {importStatus}
          </div>
        )}
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-ocean-100">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-ocean-600 mb-1">Buscar</label>
            <input
              type="text"
              placeholder="Nombre o descripción..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
            />
          </div>

          <div className="min-w-[150px]">
            <label className="block text-xs text-ocean-600 mb-1">Categoría</label>
            <select
              value={filterCategoria}
              onChange={(e) => setFilterCategoria(e.target.value)}
              className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
            >
              <option value="all">Todas</option>
              {categorias.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={loadProducts}
              disabled={isLoading}
              className="px-4 py-2 bg-ocean-100 text-ocean-700 rounded-lg text-sm hover:bg-ocean-200 transition-colors"
            >
              {isLoading ? '...' : 'Actualizar'}
            </button>
          </div>
        </div>
      </div>

      {/* Lista de productos */}
      <div className="bg-white rounded-xl shadow-sm border border-ocean-100 overflow-hidden">
        {isLoading && products.length === 0 ? (
          <div className="p-8 text-center text-ocean-600">Cargando productos...</div>
        ) : error ? (
          <div className="p-8 text-center text-red-600">{error}</div>
        ) : filteredProducts.length === 0 ? (
          <div className="p-8 text-center text-ocean-600">
            {products.length === 0 ? 'No hay productos. Importa desde Google Sheet o crea uno nuevo.' : 'No hay productos que coincidan con el filtro.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-ocean-50 border-b border-ocean-100">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-ocean-700">Producto</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-ocean-700 hidden md:table-cell">Categoría</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-ocean-700">Precio BCV</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-ocean-700 hidden md:table-cell">Divisa</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-ocean-700">Unidad</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-ocean-700">Estado</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-ocean-700">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ocean-100">
                {filteredProducts.map((product) => (
                  <tr key={product.id} className={`hover:bg-ocean-50/50 ${!product.disponible ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3">
                      <div>
                        <span className="font-medium text-ocean-900">{product.nombre}</span>
                        {product.descripcion && (
                          <p className="text-xs text-ocean-500 truncate max-w-[200px]">{product.descripcion}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-ocean-700 hidden md:table-cell">
                      <span className="px-2 py-1 bg-ocean-100 rounded-full text-xs">{product.categoria}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-semibold text-coral-600">{formatUSD(product.precioUSD)}</span>
                    </td>
                    <td className="px-4 py-3 text-right hidden md:table-cell">
                      {product.precioUSDDivisa != null ? (
                        <span className="font-semibold text-green-600">{formatUSD(product.precioUSDDivisa)}</span>
                      ) : (
                        <span className="text-ocean-300">&mdash;</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-ocean-600">
                      {product.unidad}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleToggleDisponible(product)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                          product.disponible
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-red-100 text-red-700 hover:bg-red-200'
                        }`}
                      >
                        {product.disponible ? 'Disponible' : 'No disponible'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handleEditProduct(product)}
                          className="p-1.5 text-ocean-600 hover:bg-ocean-50 rounded-lg transition-colors"
                          title="Editar"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(product)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Eliminar"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de crear/editar */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl my-4">
            <div className="p-4 border-b border-ocean-100 flex items-center justify-between">
              <h3 className="font-bold text-ocean-900">
                {editingProduct ? 'Editar Producto' : 'Nuevo Producto'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 text-ocean-600 hover:bg-ocean-50 rounded-lg"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">
                  Nombre *
                </label>
                <input
                  type="text"
                  value={formData.nombre}
                  onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
                  placeholder="Ej: Camarones Jumbo"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">
                  Descripción Completa
                  <span className="font-normal text-ocean-500 ml-1">(popup al tocar producto)</span>
                </label>
                <textarea
                  value={formData.descripcion}
                  onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none resize-none"
                  placeholder="Descripción detallada del producto..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">
                  Descripción Corta
                  <span className="font-normal text-ocean-500 ml-1">(lista de precios)</span>
                </label>
                <textarea
                  value={formData.descripcionCorta}
                  onChange={(e) => setFormData({ ...formData, descripcionCorta: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none resize-none"
                  placeholder="1-2 oraciones para la lista de precios..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">
                  Descripción Home
                  <span className="font-normal text-ocean-500 ml-1">(cards en inicio, 5-7 palabras)</span>
                </label>
                <input
                  type="text"
                  value={formData.descripcionHome}
                  onChange={(e) => setFormData({ ...formData, descripcionHome: e.target.value })}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
                  placeholder="Ej: Fresco del mar, textura firme"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ocean-700 mb-1">
                    Categoría *
                  </label>
                  <select
                    value={formData.categoria}
                    onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
                    className="w-full px-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
                  >
                    <option value="">Seleccionar...</option>
                    {categorias.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                    <option value="Pescados">Pescados</option>
                    <option value="Mariscos">Mariscos</option>
                    <option value="Crustáceos">Crustáceos</option>
                    <option value="Moluscos">Moluscos</option>
                    <option value="Otros">Otros</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-ocean-700 mb-1">
                    Unidad *
                  </label>
                  <select
                    value={formData.unidad}
                    onChange={(e) => setFormData({ ...formData, unidad: e.target.value })}
                    className="w-full px-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
                  >
                    <option value="kg">kg</option>
                    <option value="unidad">unidad</option>
                    <option value="docena">docena</option>
                    <option value="libra">libra</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ocean-700 mb-1">
                    Precio BCV *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ocean-500">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.precioUSD}
                      onChange={(e) => setFormData({ ...formData, precioUSD: e.target.value })}
                      className="w-full pl-7 pr-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-ocean-700 mb-1">
                    Precio Divisa
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ocean-500">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.precioUSDDivisa}
                      onChange={(e) => setFormData({ ...formData, precioUSDDivisa: e.target.value })}
                      className="w-full pl-7 pr-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
                      placeholder="Igual al BCV"
                    />
                  </div>
                </div>

                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.disponible}
                      onChange={(e) => setFormData({ ...formData, disponible: e.target.checked })}
                      className="w-4 h-4 text-ocean-600 rounded border-ocean-300 focus:ring-ocean-500"
                    />
                    <span className="text-sm text-ocean-700">Disponible</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-ocean-100 flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-ocean-700 hover:bg-ocean-50 rounded-lg text-sm font-medium transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveProduct}
                disabled={isSaving}
                className="px-4 py-2 bg-ocean-600 hover:bg-ocean-500 disabled:bg-ocean-300 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {isSaving ? 'Guardando...' : editingProduct ? 'Guardar Cambios' : 'Crear Producto'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
