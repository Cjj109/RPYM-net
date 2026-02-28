import type { UndoAction } from './types';
import { UndoIcon } from './icons';

interface UndoToastProps {
  action: UndoAction;
  onUndo: () => void;
  onDismiss: () => void;
}

function getLabel(action: UndoAction): string {
  switch (action.type) {
    case 'delete_entry': return 'Entrada eliminada';
    case 'clear_all': return 'Operaciones limpiadas';
    case 'toggle_sign': return 'Signo cambiado';
  }
}

export function UndoToast({ action, onUndo, onDismiss }: UndoToastProps) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-ocean-800 text-white px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-3 animate-slide-up">
      <span className="text-sm">{getLabel(action)}</span>
      <button
        onClick={onUndo}
        className="flex items-center gap-1 text-sm font-semibold text-ocean-200 hover:text-white transition-colors"
      >
        <UndoIcon className="w-3.5 h-3.5" />
        Deshacer
      </button>
      <button
        onClick={onDismiss}
        className="text-ocean-400 hover:text-white transition-colors ml-1"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
