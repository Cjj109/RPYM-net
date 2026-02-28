import { useState, useRef, useEffect } from 'react';
import { QuestionIcon } from './icons';

const SHORTCUTS = [
  { keys: '← →', desc: 'Cambiar cliente' },
  { keys: '↑', desc: 'Enfocar monto' },
  { keys: 'Espacio', desc: 'Insertar +' },
  { keys: 'Esc', desc: 'Limpiar monto' },
  { keys: 'Enter', desc: 'Agregar entrada' },
  { keys: '\\', desc: 'Limpiar todo' },
];

export function KeyboardHelp() {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!show) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShow(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [show]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setShow(prev => !prev)}
        className={`p-1.5 rounded-lg transition-colors ${show ? 'bg-ocean-100 text-ocean-700' : 'text-ocean-400 hover:text-ocean-600 hover:bg-ocean-50'}`}
        title="Atajos de teclado"
      >
        <QuestionIcon />
      </button>
      {show && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-lg shadow-lg border border-ocean-200 p-3 w-48">
          <p className="text-xs font-semibold text-ocean-700 mb-2">Atajos de teclado</p>
          <div className="space-y-1.5">
            {SHORTCUTS.map(s => (
              <div key={s.keys} className="flex items-center justify-between text-xs">
                <kbd className="bg-ocean-100 text-ocean-600 px-1.5 py-0.5 rounded font-mono text-[10px]">{s.keys}</kbd>
                <span className="text-ocean-500">{s.desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
