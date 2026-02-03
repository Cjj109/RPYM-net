import { useState, useMemo } from 'react';

interface Product {
  id: string;
  nombre: string;
  descripcionCorta: string;
  precioUSD: number;
  precioBs: number;
  unidad: string;
  disponible: boolean;
  masVendido?: boolean;
}

interface Category {
  name: string;
  products: Product[];
}

interface BCVRate {
  rate: number;
  date: string;
  source: string;
}

interface Props {
  categories: Category[];
  bcvRate: BCVRate;
}

function formatPriceUSD(price: number): string {
  return `$${price.toFixed(2)}`;
}

function formatPriceBs(price: number): string {
  return `Bs. ${price.toFixed(2)}`;
}

export default function PriceListSearch({ categories, bcvRate }: Props) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredCategories = useMemo(() => {
    if (!searchTerm.trim()) return categories;
    const term = searchTerm.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return categories
      .map(cat => ({
        ...cat,
        products: cat.products.filter(p => {
          const nombre = p.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const desc = (p.descripcionCorta || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          return nombre.includes(term) || desc.includes(term);
        })
      }))
      .filter(cat => cat.products.length > 0);
  }, [categories, searchTerm]);

  return (
    <div>
      {/* Buscador */}
      <div className="mb-6 relative">
        <div className="relative">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-ocean-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar producto... ej: camarón, pulpo, calamar"
            className="w-full pl-12 pr-10 py-3 bg-white border border-ocean-200 rounded-xl text-ocean-900 placeholder:text-ocean-400 focus:outline-none focus:ring-2 focus:ring-ocean-500 focus:border-transparent shadow-sm"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-ocean-400 hover:text-ocean-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Resultados */}
      {filteredCategories.length === 0 ? (
        <div className="text-center py-12">
          <svg className="w-12 h-12 mx-auto text-ocean-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-ocean-700 font-medium">No se encontraron productos</p>
          <p className="text-ocean-500 text-sm mt-1">Intenta con otro término de búsqueda</p>
        </div>
      ) : (
        <div className="space-y-6">
          {filteredCategories.map((category) => (
            <div key={category.name} className="bg-white rounded-xl shadow-sm border border-ocean-100 overflow-hidden">
              <div className="bg-ocean-50 px-4 py-3 border-b border-ocean-100">
                <h2 className="font-display font-semibold text-ocean-900 text-lg">
                  {category.name}
                </h2>
              </div>

              <div className="divide-y divide-ocean-100">
                {category.products.filter(p => p.disponible).map((product) => (
                  <div key={product.id} className="px-4 py-3 flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-ocean-900 font-medium">{product.nombre}</span>
                        {product.masVendido && (
                          <span className="inline-flex items-center px-1.5 py-0.5 bg-coral-100 text-coral-700 text-[10px] font-medium rounded">
                            Popular
                          </span>
                        )}
                      </div>
                      {product.descripcionCorta && (
                        <p className="text-ocean-700 text-xs mt-0.5">{product.descripcionCorta}</p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-coral-600 font-bold">
                        {formatPriceUSD(product.precioUSD)}
                      </div>
                      <div className="text-ocean-700 text-xs">
                        {formatPriceBs(product.precioBs)}
                      </div>
                      <div className="text-ocean-700 text-[10px]">
                        /{product.unidad}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
