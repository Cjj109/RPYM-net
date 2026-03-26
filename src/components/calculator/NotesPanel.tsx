import { useCallback, useRef, useEffect, useState } from 'react';

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

type Fmt = 'bold' | 'italic' | 'underline' | 'strikeThrough' | 'insertUnorderedList' | 'insertOrderedList';

const TOOLBAR: { cmd: Fmt; label: string; className: string }[] = [
  { cmd: 'bold', label: 'B', className: 'font-bold' },
  { cmd: 'italic', label: 'I', className: 'italic' },
  { cmd: 'underline', label: 'U', className: 'underline' },
  { cmd: 'strikeThrough', label: 'S', className: 'line-through' },
  { cmd: 'insertUnorderedList', label: '•', className: '' },
  { cmd: 'insertOrderedList', label: '1.', className: 'text-[10px]' },
];

export function NotesPanel({ notes, lastEdited, onChange, onClear }: NotesPanelProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalChange = useRef(false);
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());

  // Sincronizar HTML externo → editor (solo si cambió desde fuera)
  useEffect(() => {
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    const el = editorRef.current;
    if (el && el.innerHTML !== notes) {
      el.innerHTML = notes || '';
    }
  }, [notes]);

  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    isInternalChange.current = true;
    onChange(el.innerHTML);
  }, [onChange]);

  const execCmd = useCallback((cmd: Fmt) => {
    document.execCommand(cmd, false);
    editorRef.current?.focus();
    handleInput();
    updateActiveFormats();
  }, [handleInput]);

  const updateActiveFormats = useCallback(() => {
    const set = new Set<string>();
    if (document.queryCommandState('bold')) set.add('bold');
    if (document.queryCommandState('italic')) set.add('italic');
    if (document.queryCommandState('underline')) set.add('underline');
    if (document.queryCommandState('strikeThrough')) set.add('strikeThrough');
    if (document.queryCommandState('insertUnorderedList')) set.add('insertUnorderedList');
    if (document.queryCommandState('insertOrderedList')) set.add('insertOrderedList');
    setActiveFormats(set);
  }, []);

  const hasContent = notes && notes !== '' && notes !== '<br>';

  return (
    <div className="mb-3 bg-white rounded-lg border border-ocean-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-ocean-100 bg-ocean-50/50">
        <span className="text-xs font-semibold text-ocean-700">Notas rápidas</span>
        {hasContent && (
          <button
            onClick={() => {
              if (editorRef.current) editorRef.current.innerHTML = '';
              onClear();
            }}
            className="text-[10px] text-red-400 hover:text-red-600 transition-colors"
          >
            Borrar
          </button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-ocean-50 bg-ocean-50/30">
        {TOOLBAR.map(({ cmd, label, className }) => (
          <button
            key={cmd}
            type="button"
            onMouseDown={e => e.preventDefault()}
            onClick={() => execCmd(cmd)}
            className={`w-7 h-7 flex items-center justify-center rounded text-xs transition-colors ${className} ${
              activeFormats.has(cmd)
                ? 'bg-ocean-200 text-ocean-800'
                : 'text-ocean-500 hover:bg-ocean-100 hover:text-ocean-700'
            }`}
            title={cmd}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Editor */}
      <div className="p-2">
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onKeyUp={updateActiveFormats}
          onMouseUp={updateActiveFormats}
          data-placeholder="Escribe aquí tus notas..."
          spellCheck={false}
          className="w-full min-h-[100px] text-xs text-ocean-800 bg-transparent outline-none leading-relaxed empty:before:content-[attr(data-placeholder)] empty:before:text-ocean-300 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:py-0.5"
        />
      </div>

      {/* Footer */}
      {lastEdited && (
        <div className="px-3 py-1.5 border-t border-ocean-100 bg-ocean-50/30">
          <span className="text-[10px] text-ocean-300">Editado: {formatLastEdited(lastEdited)}</span>
        </div>
      )}
    </div>
  );
}
