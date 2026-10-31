import { Link } from '@/context/RouterContext';
import { MessageSquare } from 'lucide-react';

export function Footer() {
  const sections = [
    {
      title: 'Platform',
      links: [
        { label: 'Services', path: '/services' },
        { label: 'My orders', path: '/orders' },
        { label: 'Wallet', path: '/wallet' },
      ],
    },
    {
      title: 'Legal',
      links: [
        { label: 'Terms of Service', path: '/terms' },
        { label: 'Privacy Policy', path: '/privacy' },
        { label: 'Refund Policy', path: '/refunds' },
      ],
    },
  ];

  return (
    <footer className="border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-3">
          <div className="col-span-2 md:col-span-1">
            <Link to="/" className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white">
                <MessageSquare className="h-5 w-5" />
              </div>
              <span className="text-lg font-bold text-neutral-900 dark:text-neutral-100">AlsancakSMS</span>
            </Link>
            <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
              Secure SMS verification with virtual numbers from 180+ countries.
            </p>
          </div>

          {sections.map((section) => (
            <div key={section.title}>
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{section.title}</h3>
              <ul className="mt-3 space-y-2">
                {section.links.map((link) => (
                  <li key={link.path}>
                    <Link
                      to={link.path}
                      className="text-sm text-neutral-600 transition-colors hover:text-primary-600 dark:text-neutral-400 dark:hover:text-primary-400"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 border-t border-neutral-200 pt-6 dark:border-neutral-800">
          <p className="text-center text-sm text-neutral-500 dark:text-neutral-500">
            © 2026 AlsancakSMS. All rights reserved. This platform is intended for legitimate verification use only.
          </p>
        </div>
      </div>
    </footer>
  );
}
