'use client';

import { Plus, UserRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Combobox } from '@/components/Combobox';
import { Button, Field, Modal } from '@/components/ui';
import type { Client } from '@/data/mock/clients';
import { getLocation } from '@/data/mock/locations';
import { usd } from '@/lib/format';
import { useStore } from '@/lib/store';
import { AddClientModal } from './AddClientModal';

export type SavedClientData = NonNullable<Client['saved']>;

/**
 * Client combobox used by every calculator. When `current` is passed and the chosen client
 * has saved scenario data that differs, asks "Keep what I entered" vs "Use saved data".
 */
export function ClientPicker({
  value,
  onChange,
  required = true,
  error,
  current,
  onUseSaved,
  label,
}: {
  value: string | null;
  onChange: (clientId: string | null) => void;
  required?: boolean;
  error?: string | null;
  current?: Partial<SavedClientData>;
  onUseSaved?: (saved: SavedClientData) => void;
  label?: string;
}) {
  const { clients, getClient } = useStore();
  const [adding, setAdding] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Client | null>(null);
  const options = useMemo(() => clients.map((c) => ({ value: c.id, label: c.name, sub: c.primaryEmail || undefined })), [clients]);

  const choose = (id: string) => {
    const c = getClient(id);
    onChange(id);
    if (!c?.saved || !current || !onUseSaved) return;
    const s = c.saved;
    const differs =
      (current.price !== undefined && current.price !== s.price) ||
      (current.loanAmount !== undefined && current.loanAmount !== s.loanAmount) ||
      (current.ratePct !== undefined && current.ratePct !== s.ratePct) ||
      (current.locationId !== undefined && current.locationId !== s.locationId);
    if (differs) setConflict(c);
  };

  return (
    <Field label={label ?? `Client${required ? ' *' : ' (Optional)'}`} error={error ?? undefined}>
      <Combobox
        ariaLabel="Client"
        icon={<UserRound className="h-4 w-4" />}
        placeholder="Search or add a client…"
        value={value}
        invalid={!!error}
        options={options}
        onChange={choose}
        footer={(close, q) => (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              close();
              setAdding(q);
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-sm font-medium text-brand-700 hover:bg-brand-50"
          >
            <Plus className="h-4 w-4" />
            {q ? `Add “${q}” as a new client` : 'Add new client'}
          </button>
        )}
      />
      {value && (
        <button type="button" onClick={() => onChange(null)} className="mt-1 text-xs text-slate-500 hover:text-slate-800">
          Clear client
        </button>
      )}
      <AddClientModal open={adding !== null} initialName={adding ?? ''} onClose={() => setAdding(null)} onAdded={(c) => onChange(c.id)} />
      <Modal
        open={!!conflict}
        onClose={() => setConflict(null)}
        title={`${conflict?.name ?? 'This client'} has saved data`}
        description="The client’s last scenario doesn’t match what you entered."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConflict(null)}>
              Keep what I entered
            </Button>
            <Button
              onClick={() => {
                if (conflict?.saved) onUseSaved?.(conflict.saved);
                setConflict(null);
              }}
            >
              Use saved data
            </Button>
          </>
        }
      >
        {conflict?.saved && (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-slate-500">Saved price</dt>
              <dd className="font-semibold">{usd(conflict.saved.price)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Saved loan</dt>
              <dd className="font-semibold">{usd(conflict.saved.loanAmount)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Saved rate</dt>
              <dd className="font-semibold">{conflict.saved.ratePct}%</dd>
            </div>
            <div>
              <dt className="text-slate-500">Saved location</dt>
              <dd className="font-semibold">{getLocation(conflict.saved.locationId).label}</dd>
            </div>
          </dl>
        )}
      </Modal>
    </Field>
  );
}

/** Standard "client required" validation used by calculators. */
export function requireClient(clientId: string | null): string | null {
  return clientId ? null : 'Client name is required';
}
