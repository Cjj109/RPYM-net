import { useState, useEffect } from 'react';
import type { Product } from '../lib/sheets';

interface ProductModalProps {
  product: Product;
  isOpen: boolean;
  onClose: () => void;
}

function formatUSD(price: number): string {
  return `$${price.toFixed(2)}`;
}

function formatBs(price: number): string {
  return `Bs. ${price.toFixed(2)}`;
}

export function ProductModal({ product, isOpen, onClose }: ProductModalProps) {
  // Cerrar con Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative bg-white rounded-2xl max-w-md w-full max-h-[80vh] overflow-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header con precio */}
        <div className="bg-gradient-to-r from-ocean-600 to-ocean-700 p-4 md:p-6 text-white rounded-t-2xl">
          <div className="flex justify-between items-start gap-3">
            <div className="flex-1">
              <h3 className="text-lg md:text-xl font-display font-bold leading-tight">
                {product.nombre}
              </h3>
              {product.masVendido && (
                <span className="inline-flex items-center gap-1 mt-2 text-xs bg-coral-500 text-white px-2 py-0.5 rounded-full">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                  </svg>
                  Popular
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-white/20 rounded-full transition-colors"
              aria-label="Cerrar"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl md:text-3xl font-bold">
              {formatUSD(product.precioUSD)}
            </span>
            <span className="text-ocean-200 text-sm">
              /{product.unidad}
            </span>
          </div>
          <span className="text-ocean-200 text-sm">
            {formatBs(product.precioBs)}
          </span>
        </div>

        {/* Contenido */}
        <div className="p-4 md:p-6">
          {product.descripcion ? (
            <>
              <h4 className="text-sm font-semibold text-ocean-800 mb-2">
                Descripcion
              </h4>
              <p className="text-ocean-600 text-sm md:text-base leading-relaxed">
                {product.descripcion}
              </p>
            </>
          ) : (
            <p className="text-ocean-600 text-sm italic">
              Sin descripcion disponible.
            </p>
          )}

          {/* Info adicional */}
          <div className="mt-4 pt-4 border-t border-ocean-100">
            <div className="flex items-center gap-2 text-sm text-ocean-600">
              <svg className="w-4 h-4 text-ocean-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z"/>
              </svg>
              <span>Categoria: <strong>{product.categoria}</strong></span>
            </div>
            <div className="flex items-center gap-2 text-sm text-ocean-600 mt-2">
              <svg className="w-4 h-4 text-ocean-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"/>
              </svg>
              <span>Unidad: <strong>{product.unidad}</strong></span>
            </div>
          </div>

          {!product.disponible && (
            <div className="mt-4 bg-orange-50 border border-orange-200 rounded-lg p-3 flex items-center gap-2">
              <svg className="w-5 h-5 text-orange-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
              </svg>
              <span className="text-orange-700 text-sm font-medium">
                Producto no disponible actualmente
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 pb-4 md:px-6 md:pb-6">
          <a
            href="/presupuesto"
            className="block w-full text-center bg-coral-500 hover:bg-coral-600 text-white py-3 rounded-full font-semibold transition-colors"
          >
            Agregar al Presupuesto
          </a>
        </div>
      </div>
    </div>
  );
}
