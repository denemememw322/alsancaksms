import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { AdminLayout } from '@/components/AdminLayout';
import type { DepositRequest } from '@/types/database';
import {
  DollarSign, CheckCircle, XCircle, Clock, Search, Loader2,
  AlertCircle, Wallet, ArrowDownRight, ArrowUpRight, User,
} from 'lucide-react';

interface DepositWithUser extends DepositRequest {
  user_email?: string;
  user_display_name?: string | null;
}

export function AdminWalletPage() {
  const { user: adminUser } = useAuth();
  const [deposits, setDeposits] = useState<DepositWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'all' | 'approved' | 'rejected'>('pending');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // User search for balance adjustment
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ id: string; email: string; display_name: string | null; balance: number }[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<{ id: string; email: string; display_name: string | null; balance: number } | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  const loadDeposits = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('deposit_requests')
      .select('*, profiles!deposit_requests_user_id_fkey(email, display_name)')
      .order('created_at', { ascending: false })
      .limit(50);

    if (filter !== 'all') {
      query = query.eq('status', filter);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Error loading deposits:', error);
      setLoading(false);
      return;
    }

    const mapped: DepositWithUser[] = (data || []).map((row) => ({
      ...(row as unknown as DepositRequest),
      user_email: (row as { profiles?: { email: string } }).profiles?.email,
      user_display_name: (row as { profiles?: { display_name: string | null } }).profiles?.display_name ?? null,
    }));
    setDeposits(mapped);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    loadDeposits();
  }, [loadDeposits]);

  const handleApprove = async (depositId: string) => {
    setActionLoading(depositId);
    setActionMsg(null);
    const { data, error } = await supabase.rpc('approve_deposit', {
      p_deposit_id: depositId,
      p_admin_id: adminUser!.id,
    });
    if (error) {
      setActionMsg({ type: 'error', text: error.message });
    } else {
      const rows = data as { status: string; message: string; new_balance: number | null }[];
      const result = Array.isArray(rows) ? rows[0] : (rows as { status: string; message: string; new_balance: number | null });
      if (result?.status === 'completed') {
        setActionMsg({ type: 'success', text: `Deposit approved. New balance: ${Number(result?.new_balance ?? 0).toFixed(2)}` });
      } else if (result?.status === 'skipped') {
        setActionMsg({ type: 'error', text: result?.message ?? 'Deposit was already processed' });
      } else {
        setActionMsg({ type: 'error', text: result?.message ?? 'Approval failed' });
      }
    }
    setActionLoading(null);
    await loadDeposits();
  };

  const handleReject = async (depositId: string) => {
    if (!rejectReason.trim()) {
      setActionMsg({ type: 'error', text: 'A rejection reason is required.' });
      return;
    }
    setActionLoading(depositId);
    setActionMsg(null);
    const { data, error } = await supabase.rpc('reject_deposit', {
      p_deposit_id: depositId,
      p_admin_id: adminUser!.id,
      p_reason: rejectReason,
    });
    if (error) {
      setActionMsg({ type: 'error', text: error.message });
    } else {
      const rows = data as { status: string; message: string }[];
      const result = Array.isArray(rows) ? rows[0] : (rows as { status: string; message: string });
      if (result?.status === 'rejected') {
        setActionMsg({ type: 'success', text: 'Deposit rejected. No balance change.' });
      } else {
        setActionMsg({ type: 'error', text: result?.message ?? 'Rejection failed' });
      }
    }
    setActionLoading(null);
    setRejectingId(null);
    setRejectReason('');
    await loadDeposits();
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, display_name')
      .or(`email.ilike.%${searchQuery}%,display_name.ilike.%${searchQuery}%`)
      .limit(10);

    if (error) {
      console.error('Search error:', error);
      setSearching(false);
      return;
    }

    const results: { id: string; email: string; display_name: string | null; balance: number }[] = [];
    for (const p of (data || [])) {
      const { data: w } = await supabase
        .from('user_wallets')
        .select('balance')
        .eq('user_id', p.id)
        .maybeSingle();
      results.push({
        id: p.id,
        email: p.email,
        display_name: p.display_name,
        balance: w ? parseFloat(String((w as { balance: number }).balance)) : 0,
      });
    }
    setSearchResults(results);
    setSearching(false);
  };

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    const amount = parseFloat(adjustAmount);
    if (isNaN(amount) || amount === 0) {
      setActionMsg({ type: 'error', text: 'Enter a non-zero amount (positive to credit, negative to debit).' });
      return;
    }
    if (!adjustReason.trim()) {
      setActionMsg({ type: 'error', text: 'A reason is required for balance adjustments.' });
      return;
    }

    setAdjusting(true);
    setActionMsg(null);
    const idemKey = `adj_${selectedUser.id}_${Date.now()}`;
    const { data, error } = await supabase.rpc('admin_adjust_balance', {
      p_user_id: selectedUser.id,
      p_amount: amount,
      p_reason: adjustReason,
      p_admin_id: adminUser!.id,
      p_idempotency_key: idemKey,
    });

    if (error) {
      setActionMsg({ type: 'error', text: error.message });
    } else {
      const rows = data as { status: string; message: string; new_balance: number | null }[];
      const result = Array.isArray(rows) ? rows[0] : (rows as { status: string; message: string; new_balance: number | null });
      if (result?.status === 'completed') {
        setActionMsg({ type: 'success', text: `Balance adjusted. New balance: ${Number(result?.new_balance ?? 0).toFixed(2)}` });
        setAdjustAmount('');
        setAdjustReason('');
        setSelectedUser(null);
        setSearchQuery('');
        setSearchResults([]);
      } else {
        setActionMsg({ type: 'error', text: result?.message ?? 'Adjustment failed' });
      }
    }
    setAdjusting(false);
  };

  return (
    <AdminLayout title="Wallet & Deposits">
      {actionMsg && (
        <div className={`mb-4 flex items-start gap-2 rounded-lg p-3 text-sm ${
          actionMsg.type === 'success'
            ? 'bg-success-50 text-success-700 dark:bg-success-950/40 dark:text-success-400'
            : 'bg-error-50 text-error-700 dark:bg-error-950/40 dark:text-error-400'
        }`}>
          {actionMsg.type === 'success' ? <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />}
          <span>{actionMsg.text}</span>
        </div>
      )}

      {/* Stats row */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <DepositStatCard
          label="Pending Deposits"
          value={deposits.filter((d) => d.status === 'pending').length}
          icon={Clock}
          color="bg-warning-50 text-warning-600 dark:bg-warning-950/40 dark:text-warning-400"
        />
        <DepositStatCard
          label="Approved (shown)"
          value={deposits.filter((d) => d.status === 'approved').length}
          icon={CheckCircle}
          color="bg-success-50 text-success-600 dark:bg-success-950/40 dark:text-success-400"
        />
        <DepositStatCard
          label="Rejected (shown)"
          value={deposits.filter((d) => d.status === 'rejected').length}
          icon={XCircle}
          color="bg-error-50 text-error-600 dark:bg-error-950/40 dark:text-error-400"
        />
      </div>

      {/* Deposit review section */}
      <div className="card p-6">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
            <DollarSign className="h-5 w-5 text-primary-600" /> Deposit Requests
          </h3>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'pending' | 'all' | 'approved' | 'rejected')}
            className="input w-auto text-sm"
          >
            <option value="pending">Pending</option>
            <option value="all">All</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
          </div>
        ) : deposits.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Clock className="h-8 w-8 text-neutral-300 dark:text-neutral-700" />
            <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-500">No deposit requests found.</p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800">
                  <th className="px-3 py-2 text-left font-medium text-neutral-500">User</th>
                  <th className="px-3 py-2 text-left font-medium text-neutral-500">Amount</th>
                  <th className="px-3 py-2 text-left font-medium text-neutral-500">Method</th>
                  <th className="px-3 py-2 text-left font-medium text-neutral-500">Date</th>
                  <th className="px-3 py-2 text-left font-medium text-neutral-500">Status</th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {deposits.map((dep) => (
                  <tr key={dep.id} className="border-b border-neutral-100 dark:border-neutral-800/50">
                    <td className="px-3 py-3">
                      <p className="font-medium text-neutral-900 dark:text-neutral-100">{dep.user_email ?? 'Unknown'}</p>
                      {dep.user_display_name && <p className="text-xs text-neutral-500">{dep.user_display_name}</p>}
                      {dep.notes && <p className="mt-1 text-xs text-neutral-400">"{dep.notes}"</p>}
                    </td>
                    <td className="px-3 py-3 font-semibold text-neutral-900 dark:text-neutral-100">
                      ${parseFloat(String(dep.amount)).toFixed(2)}
                    </td>
                    <td className="px-3 py-3 capitalize text-neutral-600 dark:text-neutral-400">
                      {dep.payment_method.replace(/_/g, ' ')}
                    </td>
                    <td className="px-3 py-3 text-neutral-500">
                      {new Date(dep.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`badge ${
                        dep.status === 'pending' ? 'badge-warning' :
                        dep.status === 'approved' ? 'badge-success' :
                        dep.status === 'rejected' ? 'badge-error' :
                        'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                      }`}>{dep.status}</span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      {dep.status === 'pending' ? (
                        rejectingId === dep.id ? (
                          <div className="flex flex-col gap-2">
                            <input
                              type="text"
                              value={rejectReason}
                              onChange={(e) => setRejectReason(e.target.value)}
                              placeholder="Rejection reason..."
                              className="input text-xs"
                            />
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => handleReject(dep.id)}
                                disabled={actionLoading === dep.id}
                                className="btn-error btn-sm text-xs"
                              >
                                {actionLoading === dep.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirm Reject'}
                              </button>
                              <button
                                onClick={() => { setRejectingId(null); setRejectReason(''); }}
                                className="btn-ghost btn-sm text-xs"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={() => handleApprove(dep.id)}
                              disabled={actionLoading === dep.id}
                              className="btn-success btn-sm text-xs"
                            >
                              {actionLoading === dep.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <><CheckCircle className="h-3 w-3" /> Approve</>}
                            </button>
                            <button
                              onClick={() => { setRejectingId(dep.id); setRejectReason(''); }}
                              className="btn-error btn-sm text-xs"
                            >
                              <XCircle className="h-3 w-3" /> Reject
                            </button>
                          </div>
                        )
                      ) : (
                        <span className="text-xs text-neutral-400">
                          {dep.reviewed_at ? `Reviewed ${new Date(dep.reviewed_at).toLocaleDateString()}` : '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Balance adjustment section */}
      <div className="mt-6 card p-6">
        <h3 className="flex items-center gap-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
          <Wallet className="h-5 w-5 text-primary-600" /> Balance Adjustment
        </h3>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-500">
          Search for a user by email or name, then credit or debit their wallet. All adjustments are logged with a reason.
        </p>

        {/* Search */}
        <div className="mt-4 flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search by email or name..."
              className="input pl-9"
            />
          </div>
          <button onClick={handleSearch} disabled={searching} className="btn-secondary">
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
          </button>
        </div>

        {/* Search results */}
        {searchResults.length > 0 && !selectedUser && (
          <div className="mt-3 space-y-2">
            {searchResults.map((u) => (
              <button
                key={u.id}
                onClick={() => setSelectedUser(u)}
                className="flex w-full items-center justify-between rounded-lg border border-neutral-200 p-3 text-left transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-400">
                    <User className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{u.email}</p>
                    {u.display_name && <p className="text-xs text-neutral-500">{u.display_name}</p>}
                  </div>
                </div>
                <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">${u.balance.toFixed(2)}</span>
              </button>
            ))}
          </div>
        )}

        {/* Adjustment form */}
        {selectedUser && (
          <form onSubmit={handleAdjust} className="mt-4 space-y-4 rounded-lg border border-primary-200 bg-primary-50/50 p-4 dark:border-primary-800 dark:bg-primary-950/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 text-primary-600 dark:bg-primary-900 dark:text-primary-400">
                  <User className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{selectedUser.email}</p>
                  <p className="text-xs text-neutral-500">Current balance: ${selectedUser.balance.toFixed(2)}</p>
                </div>
              </div>
              <button type="button" onClick={() => setSelectedUser(null)} className="btn-ghost btn-sm text-xs">Change user</button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Amount (use negative for debit)</label>
                <div className="relative mt-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={adjustAmount}
                    onChange={(e) => setAdjustAmount(e.target.value)}
                    placeholder="25.00 or -10.00"
                    className="input pl-7"
                  />
                </div>
                <p className="mt-1 text-xs text-neutral-400">
                  {parseFloat(adjustAmount) > 0 ? <span className="flex items-center gap-1 text-success-600"><ArrowDownRight className="h-3 w-3" /> Credit</span> :
                   parseFloat(adjustAmount) < 0 ? <span className="flex items-center gap-1 text-error-600"><ArrowUpRight className="h-3 w-3" /> Debit</span> :
                   'Enter an amount'}
                </p>
              </div>
              <div>
                <label className="label">Reason (required)</label>
                <input
                  type="text"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="e.g. Customer service credit"
                  className="input mt-1"
                />
              </div>
            </div>

            <button type="submit" className="btn-primary w-full" disabled={adjusting}>
              {adjusting ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</> : 'Apply Adjustment'}
            </button>
          </form>
        )}
      </div>
    </AdminLayout>
  );
}

function DepositStatCard({ label, value, icon: Icon, color }: {
  label: string;
  value: number;
  icon: typeof Clock;
  color: string;
}) {
  return (
    <div className="card p-5">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="mt-3 text-2xl font-bold text-neutral-900 dark:text-neutral-100">{value}</div>
      <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-500">{label}</div>
    </div>
  );
}
