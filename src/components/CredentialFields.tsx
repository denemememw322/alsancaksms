import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Check, KeyRound } from 'lucide-react';

export interface CredentialDef { key: string; label: string; help: string; }

interface Props {
  scope: 'provider' | 'gateway';
  ownerId: string;
  fields: CredentialDef[];
}

/** Write-only secret inputs. Saved values are never fetched; only "is set" + updated time. */
export function CredentialFields({ scope, ownerId, fields }: Props) {
  const [status, setStatus] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function loadStatus() {
    const { data, error } = await supabase.rpc('admin_credential_status', { p_scope: scope, p_owner_id: ownerId });
    if (error) { setMsg({ ok: false, text: error.message }); return; }
    const m: Record<string, string> = {};
    (data as Array<{ key_name: string; updated_at: string }>).forEach((r) => { m[r.key_name] = r.updated_at; });
    setStatus(m);
  }
  useEffect(() => { loadStatus(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ownerId]);

  async function save(key: string) {
    const value = (drafts[key] || '').trim();
    if (!value) return;
    setBusy(key); setMsg(null);
    const { error } = await supabase.rpc('admin_set_credential', { p_scope: scope, p_owner_id: ownerId, p_key_name: key, p_value: value });
    setBusy(null);
    if (error) { setMsg({ ok: false, text: error.message }); return; }
    setDrafts((d) => ({ ...d, [key]: '' }));
    setMsg({ ok: true, text: 'Saved securely. The value is hidden and cannot be viewed again, only replaced.' });
    loadStatus();
  }

  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <div key={f.key}>
          <label className="label flex items-center gap-2">
            <KeyRound className="h-3.5 w-3.5" />{f.label}
            {status[f.key] && <span className="badge-success inline-flex items-center gap-1"><Check className="h-3 w-3" />Saved ••••••••</span>}
          </label>
          <div className="flex gap-2">
            <input type="password" autoComplete="new-password" className="input font-mono text-sm"
              placeholder={status[f.key] ? 'Enter a new value to replace' : 'Paste value'}
              value={drafts[f.key] || ''} onChange={(e) => setDrafts({ ...drafts, [f.key]: e.target.value })} />
            <button type="button" className="btn-secondary btn-sm" disabled={!drafts[f.key] || busy === f.key} onClick={() => save(f.key)}>
              {busy === f.key ? 'Saving…' : status[f.key] ? 'Replace' : 'Save'}
            </button>
          </div>
          <p className="mt-1 text-xs text-neutral-500">{f.help}</p>
        </div>
      ))}
      {msg && <p className={`text-xs ${msg.ok ? 'text-success-700' : 'text-error-700'}`}>{msg.text}</p>}
    </div>
  );
}
