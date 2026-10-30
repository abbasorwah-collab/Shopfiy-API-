import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { callFunction } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { ConnectionTestResult, SyncSettings } from '@/lib/types';

const EMPTY_SETTINGS: SyncSettings = {
  ingram_customer_number: '',
  ingram_country_code: 'US',
  ingram_sender_id: 'ShopifySync',
  markup_percent: 0,
  shopify_shop_domain: '',
  shopify_location_id: '',
};

const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

type TestState = { status: 'idle' | 'running' | 'done'; ok?: boolean; message?: string };

function validate(settings: SyncSettings): string | null {
  if (settings.ingram_country_code.trim().length !== 2) return 'Country code must be two letters, for example US.';
  const markup = Number(settings.markup_percent);
  if (!Number.isFinite(markup) || markup < 0 || markup > 500) return 'Price markup must be between 0 and 500 percent.';
  if (settings.shopify_shop_domain.trim() && !SHOP_DOMAIN_PATTERN.test(settings.shopify_shop_domain.trim())) {
    return 'Shopify store domain should look like your-store.myshopify.com.';
  }
  if (settings.shopify_location_id.trim() && !/^\d+$/.test(settings.shopify_location_id.trim())) {
    return 'Shopify location ID should contain only numbers.';
  }
  return null;
}

export default function SettingsView() {
  const [form, setForm] = useState<SyncSettings>(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [ingramTest, setIngramTest] = useState<TestState>({ status: 'idle' });
  const [shopifyTest, setShopifyTest] = useState<TestState>({ status: 'idle' });

  useEffect(() => {
    let active = true;
    supabase
      .from('sync_settings')
      .select('ingram_customer_number, ingram_country_code, ingram_sender_id, markup_percent, shopify_shop_domain, shopify_location_id')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setLoadError('Could not load your settings. Refresh the page to try again.');
        } else if (data) {
          setForm({ ...(data as SyncSettings), markup_percent: Number(data.markup_percent) });
        }
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function updateField<K extends keyof SyncSettings>(key: K, value: SyncSettings[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaveMessage(null);
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    const problem = validate(form);
    if (problem) {
      setSaveMessage({ tone: 'error', text: problem });
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from('sync_settings')
      .update({
        ingram_customer_number: form.ingram_customer_number.trim(),
        ingram_country_code: form.ingram_country_code.trim().toUpperCase(),
        ingram_sender_id: form.ingram_sender_id.trim() || 'ShopifySync',
        markup_percent: Number(form.markup_percent),
        shopify_shop_domain: form.shopify_shop_domain.trim().toLowerCase(),
        shopify_location_id: form.shopify_location_id.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);
    setSaving(false);

    setSaveMessage(
      error
        ? { tone: 'error', text: 'Could not save your settings. Try again.' }
        : { tone: 'success', text: 'Settings saved.' },
    );
  }

  async function runTest(
    functionName: 'ingram-sync' | 'shopify-sync',
    setState: (state: TestState) => void,
  ) {
    setState({ status: 'running' });
    try {
      const result = await callFunction<ConnectionTestResult>(functionName, { action: 'test' });
      setState({ status: 'done', ok: result.ok, message: result.message });
    } catch (err) {
      setState({
        status: 'done',
        ok: false,
        message: err instanceof Error ? err.message : 'The connection test failed.',
      });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading settings
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{loadError}</div>
    );
  }

  const inputClass =
    'mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Connect your Ingram Micro account and Shopify store, and set how your prices are calculated.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Ingram Micro</h2>
          <p className="mt-1 text-sm text-slate-500">
            Your reseller account details. The API keys are stored securely on the server and are not shown here.
          </p>
          <div className="mt-5 grid gap-5 sm:grid-cols-3">
            <label className="block sm:col-span-1">
              <span className="text-sm font-medium text-slate-700">Customer number</span>
              <input
                className={inputClass}
                value={form.ingram_customer_number}
                onChange={(event) => updateField('ingram_customer_number', event.target.value)}
                maxLength={30}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Country code</span>
              <input
                className={inputClass}
                value={form.ingram_country_code}
                onChange={(event) => updateField('ingram_country_code', event.target.value.toUpperCase())}
                maxLength={2}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Sender ID</span>
              <input
                className={inputClass}
                value={form.ingram_sender_id}
                onChange={(event) => updateField('ingram_sender_id', event.target.value)}
                maxLength={32}
              />
            </label>
          </div>
          <ConnectionTest
            label="Test Ingram Micro connection"
            state={ingramTest}
            onRun={() => void runTest('ingram-sync', setIngramTest)}
          />
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Shopify store</h2>
          <p className="mt-1 text-sm text-slate-500">
            Products are created and updated in this store. Use your myshopify.com address.
          </p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Store domain</span>
              <input
                className={inputClass}
                placeholder="your-store.myshopify.com"
                value={form.shopify_shop_domain}
                onChange={(event) => updateField('shopify_shop_domain', event.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Location ID</span>
              <input
                className={inputClass}
                placeholder="Where stock is kept"
                inputMode="numeric"
                value={form.shopify_location_id}
                onChange={(event) => updateField('shopify_location_id', event.target.value)}
              />
            </label>
          </div>
          <ConnectionTest
            label="Test Shopify connection"
            state={shopifyTest}
            onRun={() => void runTest('shopify-sync', setShopifyTest)}
          />
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Pricing</h2>
          <p className="mt-1 text-sm text-slate-500">
            Your selling price is the Ingram Micro cost plus this markup. Ingram's list price is shown as the compare-at price when it is higher.
          </p>
          <label className="mt-5 block max-w-xs">
            <span className="text-sm font-medium text-slate-700">Price markup (%)</span>
            <input
              className={inputClass}
              type="number"
              min={0}
              max={500}
              step={0.5}
              value={form.markup_percent}
              onChange={(event) => updateField('markup_percent', Number(event.target.value))}
            />
          </label>
        </section>

        <div className="sticky bottom-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <p
            role="status"
            className={`text-sm ${
              saveMessage?.tone === 'error'
                ? 'text-red-600'
                : saveMessage?.tone === 'success'
                  ? 'text-emerald-700'
                  : 'text-slate-500'
            }`}
          >
            {saveMessage?.text ?? 'Remember to save after making changes.'}
          </p>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save settings
          </button>
        </div>
      </form>
    </div>
  );
}

function ConnectionTest({
  label,
  state,
  onRun,
}: {
  label: string;
  state: TestState;
  onRun: () => void;
}) {
  return (
    <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-h-5 text-sm">
        {state.status === 'done' && state.ok && (
          <span className="flex items-center gap-2 text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> {state.message}
          </span>
        )}
        {state.status === 'done' && !state.ok && (
          <span className="flex items-center gap-2 text-red-600">
            <XCircle className="h-4 w-4" /> {state.message}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onRun}
        disabled={state.status === 'running'}
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 disabled:text-slate-400"
      >
        {state.status === 'running' && <Loader2 className="h-4 w-4 animate-spin" />}
        {label}
      </button>
    </div>
  );
}
