import {
  isSupportedCollectionPath,
  resolveCollectionTarget,
  SUPABASE_COLLECTIONS,
} from './collection-path';

describe('Supabase collection paths', () => {
  it('resolves every registered root collection to its physical table', () => {
    for (const collection of SUPABASE_COLLECTIONS) {
      expect(resolveCollectionTarget(collection)).toEqual({
        tableName: collection,
        scope: '',
      });
    }
  });

  it('preserves the parent path for nested collections', () => {
    expect(resolveCollectionTarget('users/user-123/searchHistories')).toEqual({
      tableName: 'searchHistories',
      scope: 'users/user-123',
    });
  });

  it('rejects unknown and malformed collection paths', () => {
    expect(isSupportedCollectionPath('users/user-123/searchHistories')).toBe(
      true,
    );
    expect(isSupportedCollectionPath('users/user-123/unregistered')).toBe(
      false,
    );
    expect(isSupportedCollectionPath('users/user-123')).toBe(false);
    expect(() => resolveCollectionTarget('unregistered')).toThrow(
      'Unsupported Supabase document collection',
    );
  });
});
