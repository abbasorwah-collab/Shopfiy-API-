import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const PRESET_VENDORS = ['HP', 'Lenovo', 'Zebra', 'Xerox', 'Dell', 'Cisco', 'Epson', 'Brother', 'Logitech', 'Samsung'];

type AddVendorFormProps = {
  existingNames: string[];
  onAdded: () => void;
  onError: (message: string) => void;
};

export default function AddVendorForm({ existingNames, onAdded, onError }: AddVendorFormProps) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const quickAddOptions = PRESET_VENDORS.filter(
    (preset) => !existingNames.some((existing) => existing.toLowerCase() === preset.toLowerCase()),
  );

  async function addVendor(vendorName: string) {
    const trimmed = vendorName.trim();
    if (trimmed.length < 2 || trimmed.length > 60) {
      onError('Vendor names must be between 2 and 60 characters.');
      return;
    }
    if (existingNames.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
      onError(`${trimmed} is already in your vendor list.`);
      return;
    }

    setSaving(true);
    const { error } = await supabase.from('vendors').insert({ name: trimmed, enabled: true });
    setSaving(false);
    if (error) {
      onError(error.code === '23505' ? `${trimmed} is already in your vendor list.` : 'Could not add the vendor. Try again.');
      return;
    }
    setName('');
    onAdded();
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Add a vendor</h2>
      <p className="mt-1 text-sm text-slate-500">Use the manufacturer name as Ingram Micro lists it.</p>

      <form
        className="mt-4 flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void addVendor(name);
        }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="For example, HP or Zebra"
          maxLength={60}
          disabled={saving}
          className="flex-1 rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
        />
        <button
          type="submit"
          disabled={saving || name.trim() === ''}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add vendor
        </button>
      </form>

      {quickAddOptions.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Quick add</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {quickAddOptions.map((preset) => (
              <button
                key={preset}
                type="button"
                disabled={saving}
                onClick={() => void addVendor(preset)}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700 transition-colors duration-150 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
