export interface QueryOptions<T = any> {
  staleTime?: number;
  gcTime?: number;
  retry?: number | boolean;
  refetchOnWindowFocus?: boolean;
}

export interface MutationOptions<TData = any, TVariables = any, TContext = any> {
  onMutate?: (variables: TVariables) => Promise<TContext | void> | TContext | void;
  onSuccess?: (data: TData, variables: TVariables, context: TContext | undefined) => void | Promise<void>;
  onError?: (error: Error, variables: TVariables, context: TContext | undefined) => void | Promise<void>;
  onSettled?: (data: TData | undefined, error: Error | null, variables: TVariables, context: TContext | undefined) => void | Promise<void>;
}

export interface CacheEntry<T = any> {
  data: T;
  updatedAt: number;
  staleTime: number;
  gcTime: number;
}

export class QueryCache {
  private cache = new Map<string, CacheEntry>();

  public get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    
    // Check if garbage collected
    if (Date.now() - entry.updatedAt > entry.gcTime) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.data as T;
  }

  public set<T>(key: string, data: T, options: QueryOptions = {}): void {
    const staleTime = options.staleTime ?? 5 * 60 * 1000;
    const gcTime = options.gcTime ?? 10 * 60 * 1000;
    this.cache.set(key, {
      data,
      updatedAt: Date.now(),
      staleTime,
      gcTime,
    });
  }

  public isStale(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return true;
    return Date.now() - entry.updatedAt > entry.staleTime;
  }

  public invalidate(keyPrefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(keyPrefix)) {
        this.cache.delete(key);
      }
    }
  }

  public clear(): void {
    this.cache.clear();
  }
}

export class TanStackQueryManager {
  private queryCache = new QueryCache();
  private defaultOptions: QueryOptions = {
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  };

  constructor(defaultOptions?: QueryOptions) {
    if (defaultOptions) {
      this.defaultOptions = { ...this.defaultOptions, ...defaultOptions };
    }
  }

  public getQueryData<T>(key: string): T | undefined {
    return this.queryCache.get<T>(key);
  }

  public setQueryData<T>(key: string, data: T | ((old: T | undefined) => T), options?: QueryOptions): T {
    const existing = this.getQueryData<T>(key);
    const newData = typeof data === 'function' ? (data as (old: T | undefined) => T)(existing) : data;
    this.queryCache.set(key, newData, { ...this.defaultOptions, ...options });
    return newData;
  }

  public async fetchQuery<T>(
    key: string,
    queryFn: () => Promise<T>,
    options?: QueryOptions
  ): Promise<T> {
    const mergedOpts = { ...this.defaultOptions, ...options };
    const cached = this.getQueryData<T>(key);

    if (cached !== undefined && !this.queryCache.isStale(key)) {
      return cached;
    }

    try {
      const freshData = await queryFn();
      this.setQueryData(key, freshData, mergedOpts);
      return freshData;
    } catch (error) {
      if (cached !== undefined) {
        return cached;
      }
      throw error;
    }
  }

  public async mutateOptimistic<TData = any, TVariables = any, TContext = any>(
    queryKey: string,
    mutationFn: (variables: TVariables) => Promise<TData>,
    variables: TVariables,
    optimisticUpdater: (current: TData | undefined, variables: TVariables) => TData,
    options?: MutationOptions<TData, TVariables, TContext>
  ): Promise<TData> {
    const previousData = this.getQueryData<TData>(queryKey);

    // Apply optimistic update immediately
    const optimisticData = optimisticUpdater(previousData, variables);
    this.setQueryData<TData>(queryKey, optimisticData);

    let context: TContext | undefined;
    try {
      if (options?.onMutate) {
        context = (await options.onMutate(variables)) as TContext;
      }

      const resultData = await mutationFn(variables);
      this.setQueryData<TData>(queryKey, resultData);

      if (options?.onSuccess) {
        await options.onSuccess(resultData, variables, context);
      }

      if (options?.onSettled) {
        await options.onSettled(resultData, null, variables, context);
      }

      return resultData;
    } catch (err: any) {
      // Rollback to previous state on error
      if (previousData !== undefined) {
        this.setQueryData<TData>(queryKey, previousData);
      }

      if (options?.onError) {
        await options.onError(err, variables, context);
      }

      if (options?.onSettled) {
        await options.onSettled(undefined, err, variables, context);
      }

      throw err;
    }
  }

  public invalidateQueries(keyPrefix: string): void {
    this.queryCache.invalidate(keyPrefix);
  }

  public clear(): void {
    this.queryCache.clear();
  }
}

export const queryManager = new TanStackQueryManager();
