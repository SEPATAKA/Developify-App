'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearSession, setSession } from '@/lib/api';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');
    if (recoveryMode) {
      try {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setPassword('');
        setRecoveryMode(false);
        setNotice(
          'Your password has been updated. Sign in with the new password.',
        );
        await supabase.auth.signOut();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Could not update password.',
        );
      } finally {
        setLoading(false);
      }
      return;
    }

    clearSession();
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      if (!data.session) {
        throw new Error('Supabase did not return an active session.');
      }
      const result = await api<{
        accessToken: string;
        admin: { id: string; email: string; name: string; role: string };
      }>('/auth/admin/supabase-session', {
        method: 'POST',
        body: JSON.stringify({ idToken: data.session.access_token }),
      });
      setSession(result);
      router.replace('/dashboard');
    } catch (err) {
      await supabase.auth.signOut();
      clearSession();
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword() {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setError('Enter your admin email address first.');
      return;
    }
    setResettingPassword(true);
    setError('');
    setNotice('');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        normalizedEmail,
        { redirectTo: `${window.location.origin}/login` },
      );
      if (error) throw error;
      setNotice(
        'If this email has an admin account, a password reset link has been sent.',
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not request a password reset.',
      );
    } finally {
      setResettingPassword(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md space-y-4 rounded-xl border border-zinc-200 bg-white p-8 shadow-sm"
      >
        <div>
          <p className="text-xs uppercase tracking-wide text-emerald-700">
            Developify
          </p>
          <h1 className="text-2xl font-semibold">
            {recoveryMode ? 'Set a new password' : 'Admin sign in'}
          </h1>
        </div>
        <label className="block text-sm">
          Email
          <input
            className="mt-1 w-full rounded border border-zinc-300 px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required={!recoveryMode}
            disabled={recoveryMode}
          />
        </label>
        <label className="block text-sm">
          {recoveryMode ? 'New password' : 'Password'}
          <input
            className="mt-1 w-full rounded border border-zinc-300 px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
          />
        </label>
        <button
          type="button"
          onClick={resetPassword}
          disabled={loading || resettingPassword || recoveryMode}
          className="text-sm text-emerald-800 underline disabled:opacity-60"
        >
          {resettingPassword ? 'Sending reset link…' : 'Forgot password?'}
        </button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {notice ? <p className="text-sm text-emerald-800">{notice}</p> : null}
        <button
          disabled={loading}
          className="w-full rounded bg-emerald-700 px-3 py-2 text-white disabled:opacity-60"
        >
          {loading
            ? recoveryMode
              ? 'Updating password…'
              : 'Signing in…'
            : recoveryMode
              ? 'Update password'
              : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
