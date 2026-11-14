import { useEffect, useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api, Icd11Code } from '../lib/api';
import { field } from './ui';

export const MAX_DIAGNOSIS_CODES = 5;

/**
 * Search WHO's ICD-11 list by words or code and pick up to five diagnoses.
 * Titles shown are WHO's official ones; the server checks every code again.
 */
export function Icd11Picker({ value, onChange }: { value: Icd11Code[]; onChange: (codes: Icd11Code[]) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Icd11Code[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const full = value.length >= MAX_DIAGNOSIS_CODES;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      api
        .searchIcd11(q)
        .then((r) => {
          if (cancelled) return;
          setResults(r.results);
          setActive(0);
          setFailed(false);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  function pick(c: Icd11Code): void {
    if (!value.some((v) => v.code === c.code) && !full) onChange([...value, c]);
    setQuery('');
    setResults([]);
    inputRef.current?.focus();
  }

  const open = query.trim().length >= 2 && !full;

  return (
    <div>
      {value.length > 0 && (
        <ul className="mb-2 space-y-1.5" aria-label="Chosen diagnoses">
          {value.map((c) => (
            <li key={c.code} className="flex items-start gap-2 rounded-xl bg-teal-50 px-3 py-2 text-sm ring-1 ring-teal-200">
              <span className="font-mono font-semibold text-teal-800">{c.code}</span>
              <span className="flex-1 text-ink-700">{c.title}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v.code !== c.code))}
                className="rounded p-0.5 text-ink-500 hover:bg-teal-100 hover:text-navy-900"
                aria-label={`Remove ${c.code} ${c.title}`}
              >
                <X size={15} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {full ? (
        <p className="text-xs text-ink-500">Maximum of {MAX_DIAGNOSIS_CODES} diagnoses. Remove one to add another.</p>
      ) : (
        <div className="relative">
          <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            ref={inputRef}
            id="icd11-search"
            type="search"
            role="combobox"
            aria-expanded={open && results.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (!open || results.length === 0) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const c = results[active];
                if (c) pick(c);
              }
            }}
            placeholder={value.length ? 'Add another diagnosis' : 'Search ICD-11: e.g. "falciparum malaria" or "1F40"'}
            className={`${field.input} pl-9`}
          />
          {open && (
            <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-raised">
              {failed ? (
                <p className="px-3 py-2.5 text-sm text-red-700">Search failed. Check the connection and try again.</p>
              ) : results.length === 0 ? (
                <p className="px-3 py-2.5 text-sm text-ink-500">{searching ? 'Searching…' : 'No match. Try other words or fewer words.'}</p>
              ) : (
                <ul id={listId} role="listbox" aria-label="ICD-11 matches">
                  {results.map((c, i) => (
                    <li
                      key={c.code}
                      role="option"
                      aria-selected={i === active}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pick(c);
                      }}
                      onMouseEnter={() => setActive(i)}
                      className={`flex cursor-pointer gap-3 px-3 py-2 text-sm ${i === active ? 'bg-cream-100' : ''}`}
                    >
                      <span className="w-16 flex-none font-mono font-semibold text-teal-800">{c.code}</span>
                      <span className="text-ink-700">{c.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      <p className="mt-1.5 text-xs text-ink-500">WHO ICD-11 (MMS). Pick the most specific match; up to {MAX_DIAGNOSIS_CODES}.</p>
    </div>
  );
}
