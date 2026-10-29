import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Link } from '@/context/RouterContext';
import { MessageSquare, Mail, ArrowRight, CheckCircle } from 'lucide-react';

export function ForgotPasswordPage() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: resetError } = await resetPassword(email);
    setLoading(false);
    if (resetError) {
      setError(resetError);
    } else {
      setSent(true);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link to="/" className="inline-flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white">
              <MessageSquare className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold text-neutral-900 dark:text-neutral-100">GrizzlySMS</span>
          </Link>
        </div>

        <div className="card p-8">
          {sent ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success-100 dark:bg-success-900/30">
                <CheckCircle className="h-7 w-7 text-success-600 dark:text-success-400" />
              </div>
              <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Check your email</h1>
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                If an account exists for {email}, we've sent a password reset link. For security, we don't confirm whether an account exists.
              </p>
              <Link to="/login" className="btn-secondary mt-6 inline-flex">
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Reset your password</h1>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                Enter your email and we'll send you a secure reset link.
              </p>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div>
                  <label className="label">Email address</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="input pl-10"
                      placeholder="you@example.com"
                    />
                  </div>
                </div>

                {error && (
                  <div className="rounded-lg bg-error-50 px-3.5 py-2.5 text-sm text-error-700 dark:bg-error-950/40 dark:text-error-400">
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading} className="btn-primary w-full">
                  {loading ? 'Sending...' : 'Send reset link'}
                  {!loading && <ArrowRight className="h-4 w-4" />}
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-neutral-600 dark:text-neutral-400">
                Remembered your password?{' '}
                <Link to="/login" className="font-semibold text-primary-600 hover:underline">Sign in</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
