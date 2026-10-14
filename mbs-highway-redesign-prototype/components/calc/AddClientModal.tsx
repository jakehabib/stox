'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Field, Modal, NumberInput, Select, TextInput } from '@/components/ui';
import { FICO_BANDS, type Client, type FicoBand } from '@/data/mock/clients';
import { useStore } from '@/lib/store';

const schema = z.object({
  name: z.string().trim().min(1, 'Client name is required'),
  primaryEmail: z.union([z.literal(''), z.string().email('Enter a valid email')]),
  secondaryEmail: z.union([z.literal(''), z.string().email('Enter a valid email')]),
  fico: z.enum(FICO_BANDS as [FicoBand, ...FicoBand[]]),
  monthlyIncome: z.number().min(0),
  dti: z.number().min(0).max(100, 'DTI must be 0–100%'),
});
type FormValues = z.infer<typeof schema>;

/** Add Client form (shared by Client Manager and every calculator's client picker). */
export function AddClientModal({ open, onClose, onAdded, initialName = '' }: { open: boolean; onClose: () => void; onAdded?: (c: Client) => void; initialName?: string }) {
  const { addClient, toast } = useStore();
  const { register, handleSubmit, control, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: { name: initialName, primaryEmail: '', secondaryEmail: '', fico: '720–739', monthlyIncome: 0, dti: 0 },
  });
  const submit = handleSubmit((v) => {
    const c = addClient({
      name: v.name.trim(),
      primaryEmail: v.primaryEmail,
      secondaryEmail: v.secondaryEmail || undefined,
      fico: v.fico,
      monthlyIncome: v.monthlyIncome || undefined,
      dti: v.dti || undefined,
    });
    toast(`${c.name} added`);
    onAdded?.(c);
    reset();
    onClose();
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Client"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Add</Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name *" error={formState.errors.name?.message} className="sm:col-span-2" htmlFor="ac-name">
          <TextInput id="ac-name" autoFocus placeholder="Client full name" invalid={!!formState.errors.name} {...register('name')} />
        </Field>
        <Field label="Primary Email" error={formState.errors.primaryEmail?.message} htmlFor="ac-pe">
          <TextInput id="ac-pe" type="email" placeholder="name@example.com" {...register('primaryEmail')} />
        </Field>
        <Field label="Secondary Email" error={formState.errors.secondaryEmail?.message} htmlFor="ac-se">
          <TextInput id="ac-se" type="email" placeholder="Optional" {...register('secondaryEmail')} />
        </Field>
        <Field label="FICO">
          <Controller control={control} name="fico" render={({ field }) => <Select ariaLabel="FICO" value={field.value} onChange={field.onChange} options={FICO_BANDS} />} />
        </Field>
        <Field label="Monthly Qualifying Income">
          <Controller control={control} name="monthlyIncome" render={({ field }) => <NumberInput ariaLabel="Monthly Qualifying Income" prefix="$" value={field.value} onChange={field.onChange} decimals={0} />} />
        </Field>
        <Field label="Debt-to-Income" error={formState.errors.dti?.message}>
          <Controller control={control} name="dti" render={({ field }) => <NumberInput ariaLabel="Debt-to-Income" suffix="%" value={field.value} onChange={field.onChange} decimals={2} />} />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
