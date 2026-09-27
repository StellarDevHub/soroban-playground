import { TanStackQueryManager } from '../../lib/queryClient';

describe('TanStackQueryManager', () => {
  let queryManager: TanStackQueryManager;

  beforeEach(() => {
    queryManager = new TanStackQueryManager({ staleTime: 1000 });
  });

  afterEach(() => {
    queryManager.clear();
  });

  it('stores and retrieves cached query data', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ status: 'active', balance: 100 });
    const data = await queryManager.fetchQuery('account-1', fetchFn);

    expect(data).toEqual({ status: 'active', balance: 100 });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Second call should return cached value without invoking fetchFn
    const cachedData = await queryManager.fetchQuery('account-1', fetchFn);
    expect(cachedData).toEqual({ status: 'active', balance: 100 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('performs optimistic updates and rolls back on mutation failure', async () => {
    queryManager.setQueryData('todos', ['item 1']);

    const failedMutation = jest.fn().mockRejectedValue(new Error('Network Error'));
    const onError = jest.fn();

    await expect(
      queryManager.mutateOptimistic(
        'todos',
        failedMutation,
        'item 2',
        (current, newItem) => [...(current || []), newItem],
        { onError }
      )
    ).rejects.toThrow('Network Error');

    // Should have restored previous state
    expect(queryManager.getQueryData('todos')).toEqual(['item 1']);
    expect(onError).toHaveBeenCalled();
  });

  it('invalidates queries by key prefix', () => {
    queryManager.setQueryData('contracts:1', { name: 'Token' });
    queryManager.setQueryData('contracts:2', { name: 'NFT' });
    queryManager.setQueryData('users:1', { name: 'Alice' });

    queryManager.invalidateQueries('contracts');

    expect(queryManager.getQueryData('contracts:1')).toBeUndefined();
    expect(queryManager.getQueryData('contracts:2')).toBeUndefined();
    expect(queryManager.getQueryData('users:1')).toEqual({ name: 'Alice' });
  });
});
