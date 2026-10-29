import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { Link } from '@/context/RouterContext';
import type { UserWallet, WalletTransaction, DepositRequest, DepositPaymentMethod } from '@/types/database';
import {
  Wallet, ArrowDownRight, ArrowUpRight, Plus, History, Clock,
  CheckCircle, XCircle, AlertCircle, Loader2, ArrowLeft,
} from 'lucide-react';

const PAGE_SIZE = 10;

export function WalletPage() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<UserWallet | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [deposits, setDeposits] = useState<DepositRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [txPage, setTxPage] = useState(0);
  const [txCount, setTxCount] = useState(0);
  const [tab, setTab] = useState<'transactions' | 'deposits'>('transactions');

  // Deposit form state
  const [depositAmount, setDepositAmount] = useState('');
  const [depositMethod, setDepositMethod] = useState<DepositPaymentMethod>('manual');
  const [depositNotes, setDepositNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const loadWallet = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('user_wallets')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) {
      console.error('Error loading wallet:', error);
      return;
    }
    setWallet(data as UserWallet | null);
  }, [user]);

  const loadTransactions = useCallback(async () => {
    if (!user) return;
    const from = txPage * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const [{ data, error }, { count, error: countErr }] = await Promise.all([
      supabase
        .from('wallet_transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(from, to),
      supabase
        .from('wallet_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
    ]);
    if (error || countErr) {
      console.error('Error loading transactions:', error || countErr);
      return;
    }
    setTransactions((data || []) as WalletTransaction[]);
    setTxCount(count ?? 0);
  }, [user, txPage]);

  const loadDeposits = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('deposit_requests')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      console.error('Error loading deposits:', error);
      return;
    }
    setDeposits((data || []) as DepositRequest[]);
  }, [user]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadWallet(), loadTransactions(), loadDeposits()]);
      setLoading(false);
    })();
  }, [loadWallet, loadTransactions, loadDeposits]);

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) {
      setFormError('Please enter a valid amount greater than 0.');
      return;
    }
    if (amount < 1) {
      setFormError('Minimum deposit amount is $1.00.');
      return;
    }

    setSubmitting(true);
    const { error } = await supabase
      .from('deposit_requests')
      .insert({
        user_id: user!.id,
        wallet_id: wallet!.id,
        amount,
        currency: 'USD',
        payment_method: depositMethod,
        status: 'pending',
        notes: depositNotes || null,
      })
      .select()
      .maybeSingle();

    if (error) {
      setFormError(error.message);
      setSubmitting(false);
      return;
    }

    setFormSuccess(`Deposit request for $${amount.toFixed(2)} submitted. An admin will review it shortly.`);
    setDepositAmount('');
    setDepositNotes('');
    setSubmitting(false);
    await loadDeposits();
  };

  const totalPages = Math.ceil(txCount / PAGE_SIZE);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-4">
        <Link to="/dashboard" className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
          <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
        </Link>
      </div>

      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-600 text-white">
          <Wallet className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">My Wallet</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Manage your balance, deposits, and transaction history.</p>
        </div>
      </div>

      {/* Balance card */}
      <div className="card overflow-hidden p-0">
        <div className="bg-gradient-to-br from-primary-600 to-primary-800 p-6 dark:from-primary-700 dark:to-primary-900">
          <p className="text-sm font-medium text-primary-100">Available Balance</p>
          <p className="mt-2 text-4xl font-bold text-white">
            ${wallet ? parseFloat(String(wallet.balance)).toFixed(2) : '0.00'}
          </p>
          <p className="mt-1 text-xs text-primary-200">{wallet?.currency ?? 'USD'}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        {/* Deposit form */}
        <div className="lg:col-span-2">
          <div className="card p-6">
            <div className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary-600" />
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Request Deposit</h2>
            </div>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-500">
              Submit a deposit request for admin review. Funds are credited after approval.
            </p>

            {formError && (
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-error-50 p-3 text-sm text-error-700 dark:bg-error-950/40 dark:text-error-400">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{formError}</span>
              </div>
            )}
            {formSuccess && (
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-success-50 p-3 text-sm text-success-700 dark:bg-success-950/40 dark:text-success-400">
                <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{formSuccess}</span>
              </div>
            )}

            <form onSubmit={handleDeposit} className="mt-4 space-y-4">
              <div>
                <label className="label">Amount (USD)</label>
                <div className="relative mt-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="50.00"
                    className="input pl-7"
                    disabled={submitting}
                  />
                </div>
              </div>

              <div>
                <label className="label">Payment Method</label>
                <select
                  value={depositMethod}
                  onChange={(e) => setDepositMethod(e.target.value as DepositPaymentMethod)}
                  className="input mt-1"
                  disabled={submitting}
                >
                  <option value="manual">Manual Transfer</option>
                  <option value="stripe">Credit Card (Stripe)</option>
                  <option value="crypto">Cryptocurrency</option>
                  <option value="paypal">PayPal</option>
                  <option value="bank_transfer">Bank Transfer</option>
                </select>
              </div>

              <div>
                <label className="label">Notes (optional)</label>
                <textarea
                  value={depositNotes}
                  onChange={(e) => setDepositNotes(e.target.value)}
                  placeholder="Transaction reference, screenshot link, etc."
                  rows={3}
                  className="input mt-1"
                  disabled={submitting}
                />
              </div>

              <button type="submit" className="btn-primary w-full" disabled={submitting || !wallet}>
                {submitting ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Submitting...</>
                ) : (
                  <>Submit Deposit Request</>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Transactions / Deposits tabs */}
        <div className="lg:col-span-3">
          <div className="card p-6">
            <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
              <button
                onClick={() => setTab('transactions')}
                className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  tab === 'transactions'
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100'
                }`}
              >
                <History className="h-4 w-4" /> Transactions
              </button>
              <button
                onClick={() => setTab('deposits')}
                className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  tab === 'deposits'
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100'
                }`}
              >
                <Clock className="h-4 w-4" /> Deposit Requests
              </button>
            </div>

            <div className="mt-4">
              {tab === 'transactions' && (
                <>
                  {transactions.length === 0 ? (
                    <EmptyState icon={History} text="No transactions yet" subtext="Your wallet activity will appear here." />
                  ) : (
                    <div className="space-y-2">
                      {transactions.map((tx) => (
                        <div key={tx.id} className="flex items-center justify-between rounded-lg border border-neutral-100 p-3 dark:border-neutral-800">
                          <div className="flex items-center gap-3">
                            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                              parseFloat(String(tx.amount)) >= 0
                                ? 'bg-success-50 text-success-600 dark:bg-success-950/40 dark:text-success-400'
                                : 'bg-error-50 text-error-600 dark:bg-error-950/40 dark:text-error-400'
                            }`}>
                              {parseFloat(String(tx.amount)) >= 0 ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                            </div>
                            <div>
                              <p className="text-sm font-medium capitalize text-neutral-900 dark:text-neutral-100">
                                {tx.transaction_type.replace(/_/g, ' ')}
                              </p>
                              <p className="text-xs text-neutral-500 dark:text-neutral-500">
                                {tx.description || new Date(tx.created_at).toLocaleString()}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className={`text-sm font-semibold ${
                              parseFloat(String(tx.amount)) >= 0
                                ? 'text-success-600 dark:text-success-400'
                                : 'text-error-600 dark:text-error-400'
                            }`}>
                              {parseFloat(String(tx.amount)) >= 0 ? '+' : ''}{parseFloat(String(tx.amount)).toFixed(2)}
                            </p>
                            <p className="text-xs text-neutral-400">{parseFloat(String(tx.balance_after)).toFixed(2)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {totalPages > 1 && (
                    <div className="mt-4 flex items-center justify-between">
                      <button
                        onClick={() => setTxPage(Math.max(0, txPage - 1))}
                        disabled={txPage === 0}
                        className="btn-ghost btn-sm disabled:opacity-40"
                      >
                        Previous
                      </button>
                      <span className="text-xs text-neutral-500">
                        Page {txPage + 1} of {totalPages}
                      </span>
                      <button
                        onClick={() => setTxPage(Math.min(totalPages - 1, txPage + 1))}
                        disabled={txPage >= totalPages - 1}
                        className="btn-ghost btn-sm disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}

              {tab === 'deposits' && (
                <>
                  {deposits.length === 0 ? (
                    <EmptyState icon={Clock} text="No deposit requests" subtext="Your deposit requests will appear here." />
                  ) : (
                    <div className="space-y-2">
                      {deposits.map((dep) => (
                        <div key={dep.id} className="flex items-center justify-between rounded-lg border border-neutral-100 p-3 dark:border-neutral-800">
                          <div className="flex items-center gap-3">
                            <DepositStatusIcon status={dep.status} />
                            <div>
                              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                                ${parseFloat(String(dep.amount)).toFixed(2)} · {dep.payment_method.replace(/_/g, ' ')}
                              </p>
                              <p className="text-xs text-neutral-500 dark:text-neutral-500">
                                {new Date(dep.created_at).toLocaleDateString()}
                                {dep.rejection_reason ? ` — ${dep.rejection_reason}` : ''}
                              </p>
                            </div>
                          </div>
                          <DepositStatusBadge status={dep.status} />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, text, subtext }: { icon: typeof History; text: string; subtext: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icon className="h-8 w-8 text-neutral-300 dark:text-neutral-700" />
      <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-500">{text}</p>
      <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-600">{subtext}</p>
    </div>
  );
}

function DepositStatusIcon({ status }: { status: string }) {
  const cls = 'h-8 w-8 rounded-lg flex items-center justify-center';
  if (status === 'approved')
    return <div className={`${cls} bg-success-50 text-success-600 dark:bg-success-950/40 dark:text-success-400`}><CheckCircle className="h-4 w-4" /></div>;
  if (status === 'rejected')
    return <div className={`${cls} bg-error-50 text-error-600 dark:bg-error-950/40 dark:text-error-400`}><XCircle className="h-4 w-4" /></div>;
  return <div className={`${cls} bg-warning-50 text-warning-600 dark:bg-warning-950/40 dark:text-warning-400`}><Clock className="h-4 w-4" /></div>;
}

function DepositStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'badge-warning',
    approved: 'badge-success',
    rejected: 'badge-error',
    cancelled: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
    expired: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
  };
  return <span className={`badge ${styles[status] || styles.pending}`}>{status}</span>;
}
