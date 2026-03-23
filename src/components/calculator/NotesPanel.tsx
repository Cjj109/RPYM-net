import { useCallback } from 'react';

interface NotesPanelProps {
  notes: string;
  lastEdited: number | null;
  onChange: (value: string) => void;
  onClear: () => void;
}

function formatLastEdited(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Hoy ${time}`;
  const date = d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' });
  return `${date} ${time}`;
}

export function NotesPanel({ notes, lastEdited, onChange, onClear }: NotesPanelProps) {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  }, [onChange]);

  return (
    <div className="mb-3 bg-white rounded-lg border border-ocean-100 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-ocean-100 bg-ocean-50/50">
        <span className="text-xs font-semibold text-ocean-700">Notas rápidas</span>
        {notes && (
          <button
            onClick={onClear}
            className="text-[10px] text-red-400 hover:text-red-600 transition-colors"
          >
            Borrar
          </button>
        )}
      </div>

      <div className="p-2">
        <textarea
          value={notes}
          onChange={handleChange}
          placeholder="Escribe aquí tus notas..."
          rows={5}
          className="w-full text-xs text-ocean-800 placeholder-ocean-300 bg-transparent resize-none outline-none leading-relaxed"
          spellCheck={false}
        />
      </div>

      {lastEdited && (
        <div className="px-3 py-1.5 border-t border-ocean-100 bg-ocean-50/30">
          <span className="text-[10px] text-ocean-300">Editado: {formatLastEdited(lastEdited)}</span>
        </div>
      )}
    </div>
  );
}
