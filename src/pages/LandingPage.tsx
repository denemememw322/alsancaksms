import { Link } from '@/context/RouterContext';
import { useAuth } from '@/context/AuthContext';
import {
  MessageSquare, Shield, Zap, Globe, CreditCard, Code, Lock, CheckCircle,
  ArrowRight, Search, Smartphone, Server,
} from 'lucide-react';

export function LandingPage() {
  const { user } = useAuth();

  return (
    <div className="animate-fade-in">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-primary-50/50 via-transparent to-transparent dark:from-primary-950/20" />
        <div className="absolute inset-0 -z-10 dark:bg-neutral-950" />
        <div className="absolute left-1/2 top-0 -z-10 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary-500/10 blur-3xl dark:bg-primary-500/5" />

        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 text-sm text-neutral-600 shadow-soft dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
              <span className="flex h-2 w-2 rounded-full bg-success-500" />
              180+ countries · 500+ services available
            </div>

            <h1 className="text-4xl font-bold tracking-tight text-neutral-900 sm:text-5xl lg:text-6xl dark:text-neutral-50">
              SMS verification with
              <span className="block bg-gradient-to-r from-primary-600 to-accent-500 bg-clip-text text-transparent">
                virtual numbers worldwide
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-lg text-neutral-600 dark:text-neutral-400">
              Receive SMS online with disposable virtual numbers. Verify accounts on
              500+ platforms securely, privately, and instantly — without exposing your real phone number.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link to={user ? '/dashboard' : '/signup'} className="btn-primary btn-lg w-full sm:w-auto">
                {user ? 'Go to dashboard' : 'Get started free'}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/services" className="btn-outline btn-lg w-full sm:w-auto">
                <Search className="h-4 w-4" />
                Browse services
              </Link>
            </div>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-neutral-500 dark:text-neutral-500">
              <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-success-500" /> No subscription required</span>
              <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-success-500" /> Instant activation</span>
              <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-success-500" /> Pay as you go</span>
            </div>
          </div>

          {/* Stats bar */}
          <div className="mx-auto mt-16 grid max-w-4xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-200 sm:grid-cols-4 dark:border-neutral-800 dark:bg-neutral-800">
            {[
              { value: '180+', label: 'Countries' },
              { value: '500+', label: 'Services' },
              { value: '99.9%', label: 'Uptime' },
              { value: '<5s', label: 'Avg. delivery' },
            ].map((stat) => (
              <div key={stat.label} className="bg-white px-6 py-5 text-center dark:bg-neutral-900">
                <div className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{stat.value}</div>
                <div className="mt-1 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-500">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-neutral-200 bg-white py-20 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold text-neutral-900 dark:text-neutral-100">Everything you need to verify</h2>
            <p className="mt-3 text-neutral-600 dark:text-neutral-400">
              A complete platform built for developers, testers, and businesses who need reliable SMS verification.
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: Zap, title: 'Instant activation', desc: 'Numbers are assigned and activated within seconds of ordering. No waiting, no manual steps.' },
              { icon: Shield, title: 'Privacy first', desc: 'Your real phone number stays private. Use disposable numbers for one-time verifications.' },
              { icon: Globe, title: 'Global coverage', desc: 'Virtual numbers across 180+ countries with multiple providers for redundancy.' },
              { icon: CreditCard, title: 'Flexible wallet', desc: 'Prepaid balance with full transaction history. Deposit via multiple payment methods.' },
              { icon: Code, title: 'Developer API', desc: 'Automate verifications with a clean, versioned REST API. Full documentation and examples.' },
              { icon: Lock, title: 'Secure by default', desc: 'Row-level security, encrypted credentials, audit logs, and role-based access control.' },
            ].map((feature) => (
              <div key={feature.title} className="card-hover p-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-400">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{feature.title}</h3>
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-neutral-200 bg-neutral-50 py-20 dark:border-neutral-800 dark:bg-neutral-900/30">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold text-neutral-900 dark:text-neutral-100">How it works</h2>
            <p className="mt-3 text-neutral-600 dark:text-neutral-400">
              From sign-up to SMS in three simple steps.
            </p>
          </div>

          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {[
              { icon: Smartphone, step: '01', title: 'Choose a service & country', desc: 'Browse the catalog and select the platform and country you need a number for.' },
              { icon: Server, step: '02', title: 'Get your virtual number', desc: 'A real phone number is assigned instantly. Use it on the target platform.' },
              { icon: MessageSquare, step: '03', title: 'Receive your SMS', desc: 'The verification code arrives in your dashboard. Copy it and complete your signup.' },
            ].map((item) => (
              <div key={item.step} className="relative">
                <div className="card p-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-600 text-white">
                      <item.icon className="h-5 w-5" />
                    </div>
                    <span className="text-3xl font-bold text-neutral-200 dark:text-neutral-800">{item.step}</span>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{item.title}</h3>
                  <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-neutral-200 bg-white py-20 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl bg-gradient-to-br from-primary-600 to-primary-800 px-8 py-12 text-center shadow-card sm:px-12">
            <h2 className="text-3xl font-bold text-white">Ready to start verifying?</h2>
            <p className="mx-auto mt-3 max-w-xl text-primary-100">
              Create your account, deposit funds, and receive your first SMS within minutes.
            </p>
            <Link
              to={user ? '/dashboard' : '/signup'}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-base font-semibold text-primary-700 shadow-sm transition-all hover:shadow-md"
            >
              {user ? 'Go to dashboard' : 'Create your account'}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
