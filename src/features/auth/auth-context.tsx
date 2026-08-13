import type { Session, User } from '@supabase/supabase-js';
import * as React from 'react';

import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase/client';

/**
 * Authentication state.
 *
 * The session is the ONLY source of the current user's identity. No component,
 * query or Edge Function call ever passes a user_id around: the browser sends a
 * JWT, PostgreSQL derives the user from it via auth.uid(), and Edge Functions
 * derive it by verifying the same token. A user_id in a request body would be
 * a forgery vector, so there is nowhere to put one.
 */

type AuthState = {
  session: Session | null;
  user: User | null;
  /** True until the initial session lookup resolves. */
  isLoading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = React.createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    let active = true;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) logger.warn('Failed to restore session', { error: error.message });
        setSession(data.session);
      })
      .catch((error: unknown) => {
        if (!active) return;
        logger.error('Session lookup failed', { error: String(error) });
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    // Covers sign-in, sign-out, token refresh and expiry in one place, so an
    // expired session immediately drops the UI back to the sign-in screen
    // rather than leaving stale figures on display.
    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setIsLoading(false);
      if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        logger.info('Auth state changed', { event });
      }
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const signOut = React.useCallback(async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) logger.warn('Sign out failed', { error: error.message });
  }, []);

  const value = React.useMemo<AuthState>(
    () => ({ session, user: session?.user ?? null, isLoading, signOut }),
    [session, isLoading, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}

/** The authenticated user id, or null. Used to scope query keys per user. */
export function useUserId(): string | null {
  return useAuth().user?.id ?? null;
}
