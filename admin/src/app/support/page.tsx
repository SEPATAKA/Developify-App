'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

type ChatMessage = {
  id: string;
  text: string;
  fromSupport: boolean;
  createdAt: string;
};

type Conversation = {
  userId: string;
  name: string;
  email: string;
  lastMessage: ChatMessage;
};

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
}

export default function SupportPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const loadConversations = useCallback(async () => {
    try {
      const rows = await api<Conversation[]>(
        '/admin/notifications/chat/conversations',
      );
      setConversations(rows);
      setError('');
      setSelectedUserId((current) =>
        current && rows.some((row) => row.userId === current)
          ? current
          : (rows[0]?.userId ?? ''),
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not load conversations.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (userId: string) => {
    try {
      const rows = await api<ChatMessage[]>(
        `/admin/notifications/chat/${encodeURIComponent(userId)}/messages`,
      );
      setMessages(rows);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this chat.');
    }
  }, []);

  useEffect(() => {
    void loadConversations();
    const timer = window.setInterval(() => void loadConversations(), 15000);
    return () => window.clearInterval(timer);
  }, [loadConversations]);

  useEffect(() => {
    setMessages([]);
    if (!selectedUserId) return;
    void loadMessages(selectedUserId);
    const timer = window.setInterval(
      () => void loadMessages(selectedUserId),
      10000,
    );
    return () => window.clearInterval(timer);
  }, [loadMessages, selectedUserId]);

  async function sendReply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!selectedUserId || !text || sending) return;
    setSending(true);
    setError('');
    try {
      await api<ChatMessage>(
        `/admin/notifications/chat/${encodeURIComponent(selectedUserId)}/messages`,
        { method: 'POST', body: JSON.stringify({ text }) },
      );
      setDraft('');
      await Promise.all([loadMessages(selectedUserId), loadConversations()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send this reply.');
    } finally {
      setSending(false);
    }
  }

  const selected = conversations.find(
    (conversation) => conversation.userId === selectedUserId,
  );

  return (
    <section>
      <h2 className="mb-2 text-2xl font-semibold">Support chat</h2>
      <p className="mb-6 text-sm text-zinc-500">
        Reply to messages sent from the Developify mobile app.
      </p>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}

      <div className="grid min-h-[620px] overflow-hidden rounded-xl border border-zinc-200 bg-white md:grid-cols-[300px_1fr]">
        <aside className="border-b border-zinc-200 md:border-b-0 md:border-r">
          <div className="border-b border-zinc-200 px-4 py-3 font-medium">
            Conversations
          </div>
          {loading ? (
            <p className="p-4 text-sm text-zinc-500">Loading conversations…</p>
          ) : conversations.length === 0 ? (
            <p className="p-4 text-sm text-zinc-500">
              No support messages yet.
            </p>
          ) : (
            <ul className="max-h-[520px] overflow-y-auto">
              {conversations.map((conversation) => (
                <li key={conversation.userId}>
                  <button
                    type="button"
                    onClick={() => setSelectedUserId(conversation.userId)}
                    className={`w-full border-b border-zinc-100 px-4 py-3 text-left hover:bg-zinc-50 ${
                      selectedUserId === conversation.userId
                        ? 'bg-emerald-50'
                        : ''
                    }`}
                  >
                    <span className="block truncate text-sm font-medium">
                      {conversation.name || conversation.email || 'User'}
                    </span>
                    <span className="mt-1 block truncate text-xs text-zinc-500">
                      {conversation.lastMessage.text}
                    </span>
                    <span className="mt-1 block text-[11px] text-zinc-400">
                      {formatTime(conversation.lastMessage.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="flex min-h-[520px] flex-col">
          {selected ? (
            <>
              <header className="border-b border-zinc-200 px-5 py-4">
                <h3 className="font-medium">
                  {selected.name || selected.email || 'User'}
                </h3>
                {selected.email ? (
                  <p className="text-sm text-zinc-500">{selected.email}</p>
                ) : null}
              </header>
              <div className="flex-1 space-y-3 overflow-y-auto p-5">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${
                      message.fromSupport ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <div
                      className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${
                        message.fromSupport
                          ? 'bg-emerald-700 text-white'
                          : 'bg-zinc-100 text-zinc-900'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">
                        {message.text}
                      </p>
                      <time className="mt-2 block text-[11px] opacity-70">
                        {formatTime(message.createdAt)}
                      </time>
                    </div>
                  </div>
                ))}
                {messages.length === 0 ? (
                  <p className="text-sm text-zinc-500">Loading messages…</p>
                ) : null}
              </div>
              <form
                onSubmit={sendReply}
                className="flex gap-3 border-t border-zinc-200 p-4"
              >
                <textarea
                  aria-label="Support reply"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={2000}
                  rows={2}
                  placeholder="Write a reply…"
                  className="min-w-0 flex-1 resize-y rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-700"
                />
                <button
                  type="submit"
                  disabled={sending || !draft.trim()}
                  className="self-end rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? 'Sending…' : 'Send reply'}
                </button>
              </form>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-zinc-500">
              Select a conversation to view and reply.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
