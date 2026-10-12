'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearSession, setSession } from '@/lib/api';
import { firebaseAuth } from '@/lib/firebase';
import {
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');
    clearSession();
    try {
      const credential = await signInWithEmailAndPassword(
        firebaseAuth,
        email.trim(),
        password,
      );
      if (!credential.user.emailVerified) {
        await sendEmailVerification(credential.user);
        await signOut(firebaseAuth);
        throw new Error(
          'Verify your email using the link we just sent, then sign in again.',
        );
      }
      const idToken = await credential.user.getIdToken(true);
      const result = await api<{
        accessToken: string;
        admin: { id: string; email: string; name: string; role: string };
      }>('/auth/admin/firebase-session', {
        method: 'POST',
        body: JSON.stringify({ idToken }),
      });
      setSession(result);
      router.replace('/dashboard');
    } catch (err) {
      await signOut(firebaseAuth);
      clearSession();
      const firebaseError = err as {
        code?: string;
        message?: string;
      };
      if (
        firebaseError.code === 'auth/invalid-credential' ||
        firebaseError.code === 'auth/user-not-found' ||
        firebaseError.code === 'auth/wrong-password'
      ) {
        setError(
          'Firebase could not sign in this account. Check that it exists in the configured Firebase project, or reset its password below. A legacy project admin password will not work here.',
        );
      } else {
        setError(firebaseError.message || 'Sign-in failed');
      }
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
      await sendPasswordResetEmail(firebaseAuth, normalizedEmail);
      setNotice(
        'If this email has a Firebase account, a password reset link has been sent.',
      );
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/invalid-email') {
        setError('Enter a valid email address.');
      } else {
        setError(
          'Could not request a password reset. Check Firebase Authentication settings and try again.',
        );
      }
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
          <h1 className="text-2xl font-semibold">Admin sign in</h1>
        </div>
        <label className="block text-sm">
          Email
          <input
            className="mt-1 w-full rounded border border-zinc-300 px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
          />
        </label>
        <label className="block text-sm">
          Password
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
          disabled={loading || resettingPassword}
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
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
