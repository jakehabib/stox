'use client';

/**
 * A plain `<input type="number">` renders a bare, unformatted integer while
 * typing — "14000000" with no separators, which is genuinely hard to read
 * at a glance for a salary field. This renders the same underlying number
 * as a comma-formatted, dollar-prefixed text field instead, parsing back to
 * a plain number on every keystroke.
 */
export function MoneyInput({ value, onChange, min = 0, className = '' }: {
  value: number; onChange: (n: number) => void; min?: number; className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm pointer-events-none">$</span>
      <input
        type="text"
        inputMode="numeric"
        className="input w-full font-mono pl-6"
        value={value.toLocaleString('en-US')}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^0-9]/g, '');
          onChange(Math.max(min, digits ? parseInt(digits, 10) : 0));
        }}
      />
    </div>
  );
}
