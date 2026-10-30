import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { AdminLayout } from '@/components/AdminLayout';
import { CredentialFields, type CredentialDef } from '@/components/CredentialFields';
import { AlertCircle, CreditCard, Copy, ChevronDown } from 'lucide-react';

interface Gateway {
  id: string; slug: string; name: string; is_enabled: boolean; adapter_ready: boolean;
  mode: 'sandbox' | 'live'; currency: string; min_amount: number; max_amount: number;
  customer_fee_pct: number; config: Record<string, string>; sort_order: number;
  verification_status: 'not_configured' | 'configured' | 'tested' | 'live_verified' | 'failed';
}
interface PublicField { key: string; label: string; help: string; }
interface Def { secrets: CredentialDef[]; fields: PublicField[]; note?: string; }

// NOTE: field lists for Paymos and MercanPay are provisional until their official API
// documentation is reviewed; PayTR/Stripe/PayPal follow their documented credential names.
const DEFS: Record<string, Def> = {
  paytr: {
    fields: [{ key: 'merchant_id', label: 'Merchant ID (Mağaza No)', help: 'PayTR Merchant Panel → Destek & Kurulum → Entegrasyon Bilgileri.' }],
    secrets: [
      { key: 'merchant_key', label: 'Merchant Key', help: 'Same page in the PayTR Merchant Panel.' },
      { key: 'merchant_salt', label: 'Merchant Salt', help: 'Same page in the PayTR Merchant Panel.' },
    ],
  },
  paymos: {
    fields: [{ key: 'merchant_id', label: 'Merchant / Project ID', help: 'From your Paymos dashboard.' }],
    secrets: [
      { key: 'api_key', label: 'API key', help: 'From your Paymos dashboard (API section).' },
      { key: 'webhook_secret', label: 'Webhook secret', help: 'Used to verify callbacks from Paymos.' },
    ],
    note: 'Field names are provisional until the official Paymos API documentation is reviewed.',
  },
  mercanpay: {
    fields: [{ key: 'merchant_id', label: 'Merchant ID', help: 'From your MercanPay merchant panel.' }],
    secrets: [
      { key: 'api_key', label: 'API key', help: 'From your MercanPay merchant panel.' },
      { key: 'webhook_secret', label: 'Webhook secret', help: 'Used to verify callbacks from MercanPay.' },
    ],
    note: 'Field names are provisional until the official MercanPay API documentation is reviewed.',
  },
  stripe: {
    fields: [{ key: 'publishable_key', label: 'Publishable key', help: 'Stripe Dashboard → Developers → API keys (public, starts with pk_).' }],
    secrets: [
      { key: 'secret_key', label: 'Secret key', help: 'Stripe Dashboard → Developers → API keys (starts with sk_).' },
      { key: 'webhook_secret', label: 'Webhook signing secret', help: 'Stripe Dashboard → Developers → Webhooks (starts with whsec_).' },
    ],
  },
  paypal: {
    fields: [
      { key: 'client_id', label: 'Client ID', help: 'PayPal Developer Dashboard → Apps & Credentials.' },
      { key: 'webhook_id', label: 'Webhook ID', help: 'PayPal Developer Dashboard → your app → Webhooks.' },
    ],
    secrets: [{ key: 'client_secret', label: 'Client secret', help: 'PayPal Developer Dashboard → Apps & Credentials.' }],
  },
};

const STATUS: Record<Gateway['verification_status'], { text: string; cls: string }> = {
  not_configured: { text: 'Not configured', cls: 'badge-neutral' },
  configured: { text: 'Credentials saved (untested)', cls: 'badge-neutral' },
  tested: { text: 'Sandbox tested', cls: 'badge-success' },
  live_verified: { text: 'Live verified', cls: 'badge-success' },
  failed: { text: 'Test failed', cls: 'badge-neutral' },
};

export function AdminPaymentGatewaysPage() {
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from('payment_gateways').select('*').order('sort_order');
    if (error) setError(error.message.includes('payment_gateways') ? 'Payment gateway database setup has not been applied yet.' : error.message);
    else { setGateways(data as Gateway[]); setError(null); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  return (
    <AdminLayout title="Payment Gateways">
      {error && <div className="mb-4 flex items-center gap-2 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700 dark:bg-error-950/40 dark:text-error-400"><AlertCircle className="h-4 w-4" />{error}</div>}
      <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
        Enter each gateway’s credentials here. A gateway can only be enabled for customers once its payment adapter and verified webhook handler exist; until then it stays configured but disabled.
      </p>
      {loading ? <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" /></div> : (
        <div className="space-y-4">
          {gateways.map((g) => <GatewayCard key={g.id} g={g} def={DEFS[g.slug]} isOpen={open === g.id} toggle={() => setOpen(open === g.id ? null : g.id)} reload={load} />)}
        </div>
      )}
    </AdminLayout>
  );
}

function GatewayCard({ g, def, isOpen, toggle, reload }: { g: Gateway; def?: Def; isOpen: boolean; toggle: () => void; reload: () => void }) {
  const [f, setF] = useState({ mode: g.mode, currency: g.currency, min: g.min_amount, max: g.max_amount, fee: g.customer_fee_pct, enabled: g.is_enabled, config: g.config || {} });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/payment-webhook/${g.slug}`;
  const st = STATUS[g.verification_status];

  async function save() {
    setSaving(true); setMsg(null);
    const { error } = await supabase.rpc('admin_save_gateway', {
      p_slug: g.slug, p_enabled: f.enabled, p_mode: f.mode, p_currency: f.currency, p_min: f.min, p_max: f.max,
      p_fee_pct: f.fee, p_config: f.config, p_sort: g.sort_order,
    });
    setSaving(false);
    if (error) setMsg({ ok: false, text: error.message });
    else { setMsg({ ok: true, text: 'Settings saved.' }); reload(); }
  }

  return (
    <div className="card p-5">
      <button className="flex w-full items-center justify-between text-left" onClick={toggle}>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600 dark:bg-neutral-800"><CreditCard className="h-5 w-5" /></div>
          <div><div className="font-semibold">{g.name}</div><div className="text-xs text-neutral-500">{g.mode === 'live' ? 'Live mode' : 'Sandbox mode'}</div></div>
        </div>
        <div className="flex items-center gap-2">
          <span className={st.cls}>{st.text}</span>
          {!g.adapter_ready && <span className="badge-neutral">Adapter: not implemented</span>}
          {g.is_enabled && <span className="badge-success">Enabled</span>}
          <ChevronDown className={`h-4 w-4 transition ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {isOpen && def && (
        <div className="mt-5 space-y-5 border-t border-neutral-200 pt-5 dark:border-neutral-800">
          {def.note && <p className="rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700">{def.note}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            {def.fields.map((fl) => (
              <div key={fl.key}><label className="label">{fl.label}</label>
                <input className="input font-mono text-sm" value={f.config[fl.key] || ''} onChange={(e) => setF({ ...f, config: { ...f.config, [fl.key]: e.target.value } })} />
                <p className="mt-1 text-xs text-neutral-500">{fl.help}</p></div>
            ))}
            <div><label className="label">Mode</label>
              <select className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as 'sandbox' | 'live' })}><option value="sandbox">Sandbox / test</option><option value="live">Live / production</option></select></div>
            <div><label className="label">Currency</label><input className="input" maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></div>
            <div><label className="label">Minimum deposit</label><input type="number" className="input" value={f.min} onChange={(e) => setF({ ...f, min: Number(e.target.value) })} /></div>
            <div><label className="label">Maximum deposit</label><input type="number" className="input" value={f.max} onChange={(e) => setF({ ...f, max: Number(e.target.value) })} /></div>
            <div><label className="label">Customer fee (%)</label><input type="number" step="0.001" className="input" value={f.fee} onChange={(e) => setF({ ...f, fee: Number(e.target.value) })} /></div>
            <label className={`flex items-center gap-2 text-sm ${g.adapter_ready ? '' : 'opacity-60'}`}>
              <input type="checkbox" disabled={!g.adapter_ready} checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
              Show on customer deposit page {!g.adapter_ready && '(unavailable: adapter not implemented yet)'}
            </label>
          </div>
          <button className="btn-primary btn-sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save settings'}</button>
          {msg && <p className={`text-xs ${msg.ok ? 'text-success-700' : 'text-error-700'}`}>{msg.text}</p>}

          <div className="border-t border-neutral-200 pt-4 dark:border-neutral-800">
            <h4 className="mb-2 text-sm font-semibold">Secret credentials</h4>
            <CredentialFields scope="gateway" ownerId={g.id} fields={def.secrets} />
          </div>

          <div className="border-t border-neutral-200 pt-4 dark:border-neutral-800">
            <h4 className="mb-1 text-sm font-semibold">Webhook / callback URL</h4>
            <div className="flex items-center gap-2"><code className="input flex-1 overflow-x-auto font-mono text-xs">{webhookUrl}</code>
              <button className="btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(webhookUrl)} aria-label="Copy"><Copy className="h-4 w-4" /></button></div>
            <p className="mt-1 text-xs text-warning-700">The webhook handler for this URL is not deployed yet, so the gateway cannot receive payments. Do not register this URL with the gateway until the handler is live.</p>
          </div>
        </div>
      )}
    </div>
  );
}
