import type { ReactNode } from "react";

interface Option<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

interface Props<T extends string> {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  label: string;
  small?: boolean;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  small,
}: Props<T>) {
  return (
    <div
      className={small ? "segmented small" : "segmented"}
      role="group"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
