import type { Product, Category, BCVRate } from '../lib/sheets';
import { ProductCardInteractive } from './ProductCardInteractive';

interface PriceListInteractiveProps {
  categories: Category[];
  masVendidos: Product[];
  bcvRate: BCVRate;
}

const categoryIcons: Record<string, string> = {
  'Camarones': '🦐',
  'Calamares': '🦑',
  'Mariscos': '🦀',
  'Especiales': '👑',
};

export function PriceListInteractive({ categories, masVendidos, bcvRate }: PriceListInteractiveProps) {
  return (
    <section id="precios" className="py-10 md:py-16 px-4">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-6 md:mb-8">
          <h2 className="text-2xl md:text-3xl lg:text-4xl font-display font-bold text-ocean-900 mb-3 md:mb-4">
            Lista de Precios
          </h2>
          <p className="text-ocean-600 max-w-2xl mx-auto text-sm md:text-base">
            Productos frescos del dia, directamente del muelle a tu mesa.
            Los precios pueden variar segun disponibilidad.
          </p>
        </div>

        {/* Indicador de tasa BCV */}
        <div className="flex justify-center mb-6 md:mb-10">
          <div className="inline-flex items-center gap-2 md:gap-3 bg-white border border-ocean-200 rounded-full px-3 py-2 md:px-5 md:py-2.5 shadow-sm">
            <div className="flex items-center gap-1.5 md:gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              <span className="text-xs md:text-sm font-medium text-ocean-700">Tasa BCV</span>
            </div>
            <div className="h-4 w-px bg-ocean-200"></div>
            <span className="text-base md:text-lg font-bold text-ocean-900">
              Bs. {bcvRate.rate.toFixed(2)}
            </span>
            <span className="text-[10px] md:text-xs text-ocean-600">
              / USD
            </span>
          </div>
        </div>

        <div className="space-y-6 md:space-y-10">
          {/* Seccion Mas Vendidos */}
          {masVendidos.length > 0 && (
            <div className="bg-gradient-to-br from-coral-50 to-orange-50 rounded-xl md:rounded-2xl p-4 md:p-6 lg:p-8 border border-coral-200">
              <h3 className="text-lg md:text-xl lg:text-2xl font-display font-semibold text-ocean-800 mb-4 md:mb-6 flex items-center gap-2 md:gap-3">
                <span className="text-xl md:text-2xl">🔥</span>
                Los Mas Vendidos
                <span className="text-xs md:text-sm font-normal text-ocean-600 font-body">
                  ({masVendidos.length})
                </span>
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-3">
                {masVendidos.map((product) => (
                  <ProductCardInteractive key={`mv-${product.id}`} product={product} compact />
                ))}
              </div>
            </div>
          )}

          {/* Categorias */}
          {categories.map((category) => (
            <div key={category.name} className="bg-ocean-50/50 rounded-xl md:rounded-2xl p-4 md:p-6 lg:p-8">
              <h3 className="text-lg md:text-xl lg:text-2xl font-display font-semibold text-ocean-800 mb-4 md:mb-6 flex items-center gap-2 md:gap-3">
                <span className="text-xl md:text-2xl">{categoryIcons[category.name] || '🐠'}</span>
                {category.name}
                <span className="text-xs md:text-sm font-normal text-ocean-600 font-body">
                  ({category.products.length})
                </span>
              </h3>

              {/* Micro-guía de tallas - solo para Camarones */}
              {category.name === 'Camarones' && (
                <div className="mb-4 md:mb-6 bg-gradient-to-r from-ocean-100 to-coral-50 rounded-lg p-3 md:p-4 border border-ocean-200">
                  <p className="text-sm md:text-base font-medium text-ocean-800 mb-2">
                    🦐 ¿No sabes qué camarón elegir?
                  </p>
                  <div className="flex flex-wrap gap-2 md:gap-3 text-xs md:text-sm">
                    <span className="inline-flex items-center gap-1.5 bg-white/80 px-2.5 py-1 rounded-full border border-ocean-200">
                      <span className="font-bold text-ocean-700">61/70</span>
                      <span className="text-ocean-600">Rendidor</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 bg-coral-100 px-2.5 py-1 rounded-full border border-coral-200">
                      <span className="font-bold text-coral-600">41/50</span>
                      <span className="text-coral-700">El más usado</span>
                      <span className="text-[10px]">⭐</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 bg-white/80 px-2.5 py-1 rounded-full border border-ocean-200">
                      <span className="font-bold text-ocean-700">36/40</span>
                      <span className="text-ocean-600">Grande</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 bg-white/80 px-2.5 py-1 rounded-full border border-ocean-200">
                      <span className="font-bold text-ocean-700">31/35</span>
                      <span className="text-ocean-600">Premium</span>
                    </span>
                  </div>
                  <p className="text-[10px] md:text-xs text-ocean-500 mt-2">
                    El número indica cuántos camarones vienen por libra. Menor número = camarón más grande.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
                {category.products.map((product) => (
                  <ProductCardInteractive key={product.id} product={product} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-xs md:text-sm text-ocean-600 mt-6 md:mt-8">
          Tasa {bcvRate.source} actualizada: {bcvRate.date}.
          Consulta disponibilidad por WhatsApp.
        </p>
      </div>
    </section>
  );
}
