'use client';

import { MapPin } from 'lucide-react';
import { useMemo } from 'react';
import { Combobox } from '@/components/Combobox';
import { Field } from '@/components/ui';
import { LOCATIONS } from '@/data/mock/locations';

/** Location search (mock geocoder over demo locations). */
export function LocationPicker({ value, onChange, label = 'Location', error, hint }: { value: string | null; onChange: (id: string) => void; label?: string; error?: string; hint?: string }) {
  const options = useMemo(() => LOCATIONS.map((l) => ({ value: l.id, label: l.label, sub: l.county })), []);
  return (
    <Field label={label} error={error} hint={hint}>
      <Combobox
        ariaLabel={label}
        icon={<MapPin className="h-4 w-4" />}
        placeholder="City, state or ZIP"
        value={value}
        options={options}
        onChange={onChange}
        filter={(o, q) => `${o.label} ${o.sub}`.toLowerCase().includes(q)}
        emptyText="No demo location matches — try Dallas, Marlboro or a ZIP"
      />
    </Field>
  );
}
