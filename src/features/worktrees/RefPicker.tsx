import { Check, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fuzzyRank } from "../../lib/fuzzy";

export interface PickerOption {
  value: string;
  label: string;
  detail?: string;
}

interface Props {
  label: string;
  options: PickerOption[];
  value: string | null;
  onChange: (value: string) => void;
  testId?: string;
}

const VISIBLE = 50;

/** A searchable list of refs; the chosen one is marked. */
export function RefPicker({ label, options, value, onChange, testId }: Props) {
  const [query, setQuery] = useState("");
  const list = useRef<HTMLDivElement>(null);
  // Keep the chosen ref in view, also when it is chosen by default further down the list.
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [value, options]);
  const shown = useMemo(
    () =>
      (query.trim()
        ? fuzzyRank(options, query, (o) => o.label)
        : options
      ).slice(0, VISIBLE),
    [options, query],
  );
  return (
    <div className="ref-picker" data-testid={testId}>
      <label className="search-field">
        <Search size={13} />
        <input
          value={query}
          placeholder={`Search ${label.toLowerCase()}`}
          aria-label={`Search ${label.toLowerCase()}`}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div
        className="ref-picker-list"
        role="listbox"
        aria-label={label}
        ref={list}
      >
        {shown.length === 0 ? (
          <p className="sidebar-note">Nothing matches.</p>
        ) : null}
        {shown.map((option) => (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={option.value === value}
            className={`ref-picker-item${option.value === value ? " selected" : ""}`}
            onClick={() => onChange(option.value)}
          >
            <span className="ref-picker-check">
              {option.value === value ? <Check size={13} /> : null}
            </span>
            <span className="truncate">{option.label}</span>
            {option.detail ? (
              <span className="truncate faint small-text">{option.detail}</span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
