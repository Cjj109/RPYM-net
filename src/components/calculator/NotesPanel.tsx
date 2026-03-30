import { useCallback, useRef, useEffect, useState } from 'react';

export interface NoteSheet {
  id: string;
  name: string;
  content: string;
}

interface NotesPanelProps {
  sheets: NoteSheet[];
  activeSheetId: string;
  lastEdited: number | null;
  onSheetsChange: (sheets: NoteSheet[]) => void;
  onActiveSheetChange: (id: string) => void;
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

export function NotesPanel({ sheets, activeSheetId, lastEdited, onSheetsChange, onActiveSheetChange, onClear }: NotesPanelProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalChange = useRef(false);
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const activeSheet = sheets.find(s => s.id === activeSheetId) ?? sheets[0];
  const activeContent = activeSheet?.content ?? '';

  // Sincronizar HTML externo → editor
  useEffect(() => {
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    const el = editorRef.current;
    if (el && el.innerHTML !== activeContent) {
      el.innerHTML = activeContent || '';
    }
  }, [activeContent, activeSheetId]);

  // Focus rename input
  useEffect(() => {
    if (editingTabId) renameInputRef.current?.focus();
  }, [editingTabId]);

  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (!el || !activeSheet) return;
    isInternalChange.current = true;
    const newSheets = sheets.map(s =>
      s.id === activeSheet.id ? { ...s, content: el.innerHTML } : s
    );
    onSheetsChange(newSheets);
  }, [sheets, activeSheet, onSheetsChange]);

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

  const addSheet = useCallback(() => {
    const newSheet: NoteSheet = {
      id: crypto.randomUUID(),
      name: `Hoja ${sheets.length + 1}`,
      content: '',
    };
    onSheetsChange([...sheets, newSheet]);
    onActiveSheetChange(newSheet.id);
  }, [sheets, onSheetsChange, onActiveSheetChange]);

  const deleteSheet = useCallback((id: string) => {
    if (sheets.length <= 1) return;
    const newSheets = sheets.filter(s => s.id !== id);
    onSheetsChange(newSheets);
    if (activeSheetId === id) {
      onActiveSheetChange(newSheets[0].id);
    }
  }, [sheets, activeSheetId, onSheetsChange, onActiveSheetChange]);

  const commitRename = useCallback(() => {
    if (!editingTabId || !editingName.trim()) {
      setEditingTabId(null);
      return;
    }
    onSheetsChange(sheets.map(s =>
      s.id === editingTabId ? { ...s, name: editingName.trim() } : s
    ));
    setEditingTabId(null);
  }, [editingTabId, editingName, sheets, onSheetsChange]);

  const hasContent = sheets.some(s => s.content && s.content !== '' && s.content !== '<br>');

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
            Borrar todo
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

      {/* Sheet tabs */}
      <div className="flex items-center border-t border-ocean-100 bg-ocean-50/30 overflow-x-auto">
        {sheets.map(sheet => (
          <div
            key={sheet.id}
            className={`group flex items-center gap-1 px-3 py-1.5 text-[11px] border-r border-ocean-100 cursor-pointer select-none shrink-0 ${
              sheet.id === activeSheetId
                ? 'bg-white text-ocean-800 font-semibold'
                : 'text-ocean-400 hover:bg-ocean-50 hover:text-ocean-600'
            }`}
            onClick={() => {
              if (editingTabId !== sheet.id) onActiveSheetChange(sheet.id);
            }}
            onDoubleClick={() => {
              setEditingTabId(sheet.id);
              setEditingName(sheet.name);
            }}
          >
            {editingTabId === sheet.id ? (
              <input
                ref={renameInputRef}
                value={editingName}
                onChange={e => setEditingName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setEditingTabId(null);
                }}
                className="w-16 text-[11px] bg-transparent border-b border-ocean-300 outline-none"
                maxLength={20}
              />
            ) : (
              <span className="max-w-[80px] truncate">{sheet.name}</span>
            )}
            {sheets.length > 1 && sheet.id === activeSheetId && !editingTabId && (
              <button
                onClick={e => { e.stopPropagation(); deleteSheet(sheet.id); }}
                className="opacity-0 group-hover:opacity-100 text-ocean-300 hover:text-red-400 transition-all ml-0.5"
                title="Eliminar hoja"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                  <path d="M5.28 4.22a.75.75 0 00-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 101.06 1.06L8 9.06l2.72 2.72a.75.75 0 101.06-1.06L9.06 8l2.72-2.72a.75.75 0 00-1.06-1.06L8 6.94 5.28 4.22z" />
                </svg>
              </button>
            )}
          </div>
        ))}
        {/* Add sheet button */}
        <button
          onClick={addSheet}
          className="px-2 py-1.5 text-ocean-300 hover:text-ocean-600 hover:bg-ocean-50 transition-colors shrink-0"
          title="Nueva hoja"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
            <path d="M8.75 3.75a.75.75 0 00-1.5 0v3.5h-3.5a.75.75 0 000 1.5h3.5v3.5a.75.75 0 001.5 0v-3.5h3.5a.75.75 0 000-1.5h-3.5v-3.5z" />
          </svg>
        </button>
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
