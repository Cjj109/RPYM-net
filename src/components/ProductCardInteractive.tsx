import { useState } from 'react';
import type { Product } from '../lib/sheets';
import { ProductModal } from './ProductModal';

interface ProductCardInteractiveProps {
  product: Product;
  compact?: boolean;
}

function formatUSD(price: number): string {
  return `$${price.toFixed(2)}`;
}

function formatBs(price: number): string {
  return `Bs. ${price.toFixed(2)}`;
}

export function ProductCardInteractive({ product, compact = false }: ProductCardInteractiveProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className={`
          w-full text-left bg-white rounded-xl p-3 md:p-4 shadow-sm border border-ocean-100
          hover:shadow-md hover:border-ocean-200 transition-all duration-300
          active:scale-[0.98] cursor-pointer
          ${!product.disponible ? 'opacity-60' : ''}
          ${compact ? 'p-2.5 md:p-3' : ''}
        `}
      >
        <div className="flex items-start justify-between gap-2 md:gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className={`font-semibold text-ocean-900 leading-tight truncate ${compact ? 'text-sm' : 'text-sm md:text-base'}`}>
                {product.nombre}
              </h3>
              {product.masVendido && (
                <svg className="w-3.5 h-3.5 text-coral-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                </svg>
              )}
            </div>
            {product.descripcionCorta && !compact && (
              <p className="text-[11px] md:text-xs text-ocean-600 mt-1 line-clamp-1">
                {product.descripcionCorta}
              </p>
            )}
            {product.descripcion && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-ocean-600 mt-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                Ver detalles
              </span>
            )}
          </div>

          <div className="text-right flex-shrink-0">
            <span className={`font-bold text-coral-500 ${compact ? 'text-sm md:text-base' : 'text-base md:text-lg'}`}>
              {formatUSD(product.precioUSD)}
            </span>
            <span className="text-xs md:text-sm text-ocean-600 block">
              {formatBs(product.precioBs)}
            </span>
            <span className="text-[10px] md:text-xs text-ocean-600 block">
              /{product.unidad}
            </span>
          </div>
        </div>

        {!product.disponible && (
          <span className="inline-block mt-2 text-xs bg-ocean-100 text-ocean-600 px-2 py-0.5 rounded-full">
            No disponible
          </span>
        )}
      </button>

      <ProductModal
        product={product}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}
