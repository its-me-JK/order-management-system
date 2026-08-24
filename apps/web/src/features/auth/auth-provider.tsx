'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ApiError, apiRequest, type ApiRequestOptions } from '@/lib/api/client';
import { loginResponseSchema, type LoginResponse, type User } from '@/lib/api/contracts';

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

interface AuthSession {
  readonly accessToken: string;
  readonly csrfToken: string;
  readonly user: User;
}

type AuthorizedRequest = <T>(path: string, options: ApiRequestOptions<T>) => Promise<T>;

interface AuthContextValue {
  readonly isAdmin: boolean;
  readonly login: (input: LoginInput) => Promise<User>;
  readonly logout: () => Promise<void>;
  readonly request: AuthorizedRequest;
  readonly session: AuthSession | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const CSRF_STORAGE_KEY = 'oms.csrf';

function toSession(response: LoginResponse): AuthSession {
  return Object.freeze({
    accessToken: response.accessToken,
    csrfToken: response.csrfToken,
    user: response.user,
  });
}

function userIsAdmin(user: User | undefined): boolean {
  if (user === undefined) {
    return false;
  }

  return (
    user.role === 'ADMIN' ||
    user.roles.includes('ADMIN') ||
    user.permissions.some(
      (permission) =>
        permission.startsWith('inventory.') || permission.startsWith('orders.fulfillment.'),
    )
  );
}

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<AuthSession | null>(null);
  const sessionReference = useRef<AuthSession | null>(null);
  const refreshReference = useRef<Promise<AuthSession> | null>(null);
  const bootstrapReference = useRef<Promise<LoginResponse> | null>(null);

  const installSession = useCallback((nextSession: AuthSession | null): void => {
    sessionReference.current = nextSession;
    setSession(nextSession);

    if (nextSession === null) {
      sessionStorage.removeItem(CSRF_STORAGE_KEY);
    } else {
      sessionStorage.setItem(CSRF_STORAGE_KEY, nextSession.csrfToken);
    }
  }, []);

  useEffect((): void => {
    const csrfToken = sessionStorage.getItem(CSRF_STORAGE_KEY);

    if (csrfToken === null) {
      return;
    }

    bootstrapReference.current ??= apiRequest('/api/v1/auth/refresh', {
      csrfToken,
      method: 'POST',
      schema: loginResponseSchema,
    });
    void bootstrapReference.current.then(
      (response): void => {
        installSession(toSession(response));
      },
      (): void => {
        installSession(null);
      },
    );
  }, [installSession]);

  const login = useCallback(
    async (input: LoginInput): Promise<User> => {
      const response = await apiRequest('/api/v1/auth/login', {
        body: input,
        method: 'POST',
        schema: loginResponseSchema,
      });
      const nextSession = toSession(response);

      queryClient.clear();
      installSession(nextSession);

      return nextSession.user;
    },
    [installSession, queryClient],
  );

  const logout = useCallback(async (): Promise<void> => {
    const currentSession = sessionReference.current;

    try {
      if (currentSession !== null) {
        await apiRequest('/api/v1/auth/logout', {
          csrfToken: currentSession.csrfToken,
          method: 'POST',
        });
      }
    } finally {
      refreshReference.current = null;
      installSession(null);
      queryClient.clear();
    }
  }, [installSession, queryClient]);

  const refresh = useCallback(async (): Promise<AuthSession> => {
    const currentSession = sessionReference.current;

    if (currentSession === null) {
      throw new ApiError(401, 'Please sign in to continue.', null);
    }

    if (refreshReference.current === null) {
      refreshReference.current = apiRequest('/api/v1/auth/refresh', {
        csrfToken: currentSession.csrfToken,
        method: 'POST',
        schema: loginResponseSchema,
      })
        .then((response) => {
          const nextSession = toSession(response);
          installSession(nextSession);
          return nextSession;
        })
        .catch((error: unknown) => {
          installSession(null);
          queryClient.clear();
          throw error;
        })
        .finally(() => {
          refreshReference.current = null;
        });
    }

    return refreshReference.current;
  }, [installSession, queryClient]);

  const request = useCallback<AuthorizedRequest>(
    async <T,>(path: string, options: ApiRequestOptions<T>): Promise<T> => {
      const currentSession = sessionReference.current;

      if (currentSession === null) {
        throw new ApiError(401, 'Please sign in to continue.', null);
      }

      try {
        return await apiRequest(path, {
          ...options,
          accessToken: currentSession.accessToken,
          csrfToken: currentSession.csrfToken,
        });
      } catch (error: unknown) {
        if (!(error instanceof ApiError) || error.status !== 401) {
          throw error;
        }

        const refreshed = await refresh();

        return apiRequest(path, {
          ...options,
          accessToken: refreshed.accessToken,
          csrfToken: refreshed.csrfToken,
        });
      }
    },
    [refresh],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      isAdmin: userIsAdmin(session?.user),
      login,
      logout,
      request,
      session,
    }),
    [login, logout, request, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (context === null) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}
