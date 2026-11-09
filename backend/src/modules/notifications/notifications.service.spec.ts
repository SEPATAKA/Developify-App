jest.mock('../../supabase/supabase-data.service', () => ({
  SupabaseDataService: class SupabaseDataService {},
}));

import { NotificationsService } from './notifications.service';
import type { SupabaseDataService } from '../../supabase/supabase-data.service';

function message(id: string, text: string, createdAt: string) {
  const data = { userId: 'user-1', text, fromSupport: false, createdAt };
  return {
    id,
    data: () => data,
    get: (field: string) => data[field as keyof typeof data],
  };
}

describe('NotificationsService chat timestamps', () => {
  const oldest = message('oldest', 'First', '2026-11-09T10:00:00.000Z');
  const newest = message('newest', 'Last', '2026-11-09T12:00:00.000Z');
  const chatQuery = {
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ docs: [newest, oldest] }),
  };
  const profile = { get: jest.fn().mockResolvedValue({ exists: true }) };
  const service = new NotificationsService({
    documents: {
      collection: (name: string) =>
        name === 'chatMessages'
          ? chatQuery
          : { doc: () => profile },
    },
  } as unknown as SupabaseDataService);

  beforeEach(() => {
    jest.clearAllMocks();
    chatQuery.get.mockResolvedValue({ docs: [newest, oldest] });
    profile.get.mockResolvedValue({ exists: true });
  });

  it('returns mobile chat messages in chronological order', async () => {
    await expect(service.messages('user-1')).resolves.toMatchObject([
      { id: 'oldest', text: 'First', createdAt: '2026-11-09T10:00:00.000Z' },
      { id: 'newest', text: 'Last', createdAt: '2026-11-09T12:00:00.000Z' },
    ]);
  });

  it('returns admin support messages in chronological order', async () => {
    await expect(service.supportMessages('user-1')).resolves.toMatchObject([
      { id: 'oldest', text: 'First', createdAt: '2026-11-09T10:00:00.000Z' },
      { id: 'newest', text: 'Last', createdAt: '2026-11-09T12:00:00.000Z' },
    ]);
  });
});
