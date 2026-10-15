'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clearSession, getSession } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useEffect, useState } from 'react';

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/users', label: 'Users' },
  { href: '/kyc', label: 'KYC Queue' },
  { href: '/properties', label: 'Properties' },
  { href: '/projects', label: 'Projects' },
  { href: '/transactions', label: 'Transactions' },
  { href: '/support', label: 'Support chat' },
  { href: '/audit', label: 'Audit Log' },
  { href: '/config', label: 'Config' },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [uid, setUid] = useState('');
  const [role, setRole] = useState('');

  useEffect(() => {
    const session = getSession();
    if (!session && pathname !== '/login') {
      router.replace('/login');
      return;
    }
    if (session) {
      setName(session.admin.name);
      setRole(session.admin.role);
    }
    setReady(true);
  }, [pathname, router]);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setEmail(data.user?.email ?? '');
      setUid(data.user?.id ?? '');
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setEmail(session?.user.email ?? '');
      setUid(session?.user.id ?? '');
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-600">
        Loading…
      </div>
    );
  }

  if (pathname === '/login') return <>{children}</>;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <div className="mx-auto flex min-h-screen max-w-7xl">
        <aside className="w-56 border-r border-zinc-200 bg-white p-4">
          <div className="mb-8">
            <p className="text-xs uppercase tracking-wide text-emerald-700">
              Developify
            </p>
            <h1 className="text-lg font-semibold">Admin</h1>
            <p className="text-sm text-zinc-500">{name}</p>
            <p className="mt-1 break-all text-xs text-zinc-500">{email}</p>
            {role ? (
              <p className="mt-1 text-xs capitalize text-zinc-500">{role}</p>
            ) : null}
            {uid ? (
              <p className="mt-1 break-all text-[10px] text-zinc-400">
                Supabase user ID: {uid}
              </p>
            ) : null}
          </div>
          <nav className="space-y-1">
            {links
              .filter(
                (link) =>
                  link.href !== '/support' ||
                  role === 'admin' ||
                  role === 'ops',
              )
              .map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`block rounded px-3 py-2 text-sm ${
                    pathname.startsWith(link.href)
                      ? 'bg-emerald-50 font-medium text-emerald-800'
                      : 'text-zinc-700 hover:bg-zinc-100'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
          </nav>
          <button
            className="mt-8 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
            onClick={async () => {
              await supabase.auth.signOut();
              clearSession();
              router.replace('/login');
            }}
          >
            Sign out
          </button>
        </aside>
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
