import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Link } from '@/context/RouterContext';
import { supabase } from '@/lib/supabase';
import type { UserWallet, WalletTransaction } from '@/types/database';
import {
  Wallet, Clock, CheckCircle, XCircle, TrendingUp, ArrowDownRight, ArrowUpRight,
  ArrowLeft, Loader2,
} from 'lucide-react';

export function DashboardPage() {
  const { user, profile } = useAuth();
  const [wallet, setWallet] = useState<UserWallet | null>(null);
  const [recentTx, setRecentTx] = useState<WalletTransaction[]>([]);
  const [totals, setTotals] = useState({ deposits: 0, spending: 0 });
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const { data: w, error: wErr } = await supabase
      .from('user_wallets')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (wErr) console.error('Wallet error:', wErr);
    setWallet(w as UserWallet | null);

    const { data: txns, error: txErr } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5);

    if (txErr) console.error('Transactions error:', txErr);
    const txList = (txns || []) as WalletTransaction[];
    setRecentTx(txList);

    let depSum = 0;
    let spendSum = 0;
    for (const tx of txList) {
      const amt = parseFloat(String(tx.amount));
      if (amt > 0) depSum += amt;
      else spendSum += Math.abs(amt);
    }
    setTotals({ deposits: depSum, spending: spendSum });
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const balance = wallet ? parseFloat(String(wallet.balance)) : 0;

  const stats = [
    { label: 'Available balance', value: `$${balance.toFixed(2)}`, icon: Wallet, iconClass: 'bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-400' },
    { label: 'Total deposits', value: `$${totals.deposits.toFixed(2)}`, icon: ArrowDownRight, iconClass: 'bg-success-50 text-success-600 dark:bg-success-950/40 dark:text-success-400' },
    { label: 'Total spending', value: `$${totals.spending.toFixed(2)}`, icon: ArrowUpRight, iconClass: 'bg-error-50 text-error-600 dark:bg-error-950/40 dark:text-error-400' },
    { label: 'Active orders', value: '0', icon: Clock, iconClass: 'bg-warning-50 text-warning-600 dark:bg-warning-950/40 dark:text-warning-400' },
  ];

  const orderStats = [
    { label: 'Completed', value: 0, icon: CheckCircle, iconClass: 'bg-success-50 text-success-600 dark:bg-success-950/40 dark:text-success-400' },
    { label: 'Cancelled', value: 0, icon: XCircle, iconClass: 'bg-error-50 text-error-600 dark:bg-error-950/40 dark:text-error-400' },
    { label: 'Refunded', value: 0, icon: TrendingUp, iconClass: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400' },
  ];

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          Welcome back{profile?.display_name ? `, ${profile.display_name}` : ''}
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Here's an overview of your account activity.
        </p>
      </div>

      {/* Balance stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="card p-5">
            <div className="flex items-center justify-between">
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${stat.iconClass}`}>
                <stat.icon className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 text-2xl font-bold text-neutral-900 dark:text-neutral-100">{stat.value}</div>
            <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-500">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Order stats */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {orderStats.map((stat) => (
          <div key={stat.label} className="card p-5">
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${stat.iconClass}`}>
                <stat.icon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{stat.value}</div>
                <div className="text-sm text-neutral-500 dark:text-neutral-500">{stat.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent activity */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Recent orders</h2>
          <div className="mt-4 flex flex-col items-center justify-center py-12 text-center">
            <Clock className="h-8 w-8 text-neutral-300 dark:text-neutral-700" />
            <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-500">No orders yet</p>
            <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-600">Your recent SMS orders will appear here.</p>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Recent transactions</h2>
            <Link to="/wallet" className="flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400">
              View all <ArrowLeft className="h-3 w-3 rotate-180" />
            </Link>
          </div>
          {recentTx.length === 0 ? (
            <div className="mt-4 flex flex-col items-center justify-center py-12 text-center">
              <Wallet className="h-8 w-8 text-neutral-300 dark:text-neutral-700" />
              <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-500">No transactions yet</p>
              <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-600">Your wallet activity will appear here.</p>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {recentTx.map((tx) => (
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
                        {new Date(tx.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <p className={`text-sm font-semibold ${
                    parseFloat(String(tx.amount)) >= 0
                      ? 'text-success-600 dark:text-success-400'
                      : 'text-error-600 dark:text-error-400'
                  }`}>
                    {parseFloat(String(tx.amount)) >= 0 ? '+' : ''}{parseFloat(String(tx.amount)).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="mt-6 flex gap-3">
        <Link to="/wallet" className="btn-primary">Manage Wallet</Link>
        <Link to="/services" className="btn-secondary">Browse Services</Link>
      </div>

      {/* Account info */}
      <div className="mt-6 card p-6">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Account information</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-neutral-500 dark:text-neutral-500">Email</dt>
            <dd className="mt-0.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">{user?.email}</dd>
          </div>
          <div>
            <dt className="text-sm text-neutral-500 dark:text-neutral-500">Account status</dt>
            <dd className="mt-0.5">
              <span className="badge-success">{profile?.status ?? 'active'}</span>
            </dd>
          </div>
          <div>
            <dt className="text-sm text-neutral-500 dark:text-neutral-500">Preferred language</dt>
            <dd className="mt-0.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">{profile?.language?.toUpperCase() ?? 'EN'}</dd>
          </div>
          <div>
            <dt className="text-sm text-neutral-500 dark:text-neutral-500">Preferred currency</dt>
            <dd className="mt-0.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">{profile?.currency ?? 'USD'}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
