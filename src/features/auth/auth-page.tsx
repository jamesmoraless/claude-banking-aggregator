import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, CheckCircle2, Lock, ShieldCheck, TrendingUp } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation } from 'react-router-dom';
import { z } from 'zod';

import { AtlasLogo } from '@/components/common/logo';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { logger } from '@/lib/logger';
import { requireSupabase } from '@/lib/supabase/client';

import { useAuth } from './auth-context';

const credentialsSchema = z.object({
  email: z.string().min(1, 'Enter your email address').email('Enter a valid email address'),
  password: z.string().min(8, 'Passwords must be at least 8 characters'),
});

type Credentials = z.infer<typeof credentialsSchema>;

type Mode = 'sign-in' | 'sign-up';

export function AuthPage() {
  const { session, isLoading } = useAuth();
  const location = useLocation();
  const [mode, setMode] = React.useState<Mode>('sign-in');
  const [formError, setFormError] = React.useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = React.useState(false);

  const form = useForm<Credentials>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: '', password: '' },
  });

  if (!isLoading && session) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/sign-in' ? from : '/'} replace />;
  }

  const onSubmit = async (values: Credentials) => {
    setFormError(null);
    setConfirmationSent(false);

    try {
      const supabase = requireSupabase();

      if (mode === 'sign-up') {
        const { data, error } = await supabase.auth.signUp({
          email: values.email,
          password: values.password,
        });
        if (error) throw error;
        // With email confirmation enabled Supabase returns a user but no
        // session; say so rather than leaving the form looking inert.
        if (data.user && !data.session) {
          setConfirmationSent(true);
        }
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      });
      if (error) throw error;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Something went wrong';
      logger.warn('Authentication failed', { mode });
      // Supabase already returns deliberately vague messages for bad
      // credentials; surface them as-is rather than confirming which half
      // was wrong.
      setFormError(message);
    }
  };

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm space-y-8">
          <AtlasLogo />

          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">
              {mode === 'sign-in' ? 'Sign in to Cash Atlas' : 'Create your account'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {mode === 'sign-in'
                ? 'Your financial overview, calculated the same way every time.'
                : 'Connect your accounts and see what you actually earned and spent.'}
            </p>
          </div>

          {confirmationSent ? (
            <Alert variant="success">
              <CheckCircle2 aria-hidden="true" />
              <div>
                <AlertTitle>Check your email</AlertTitle>
                <AlertDescription>
                  We sent a confirmation link to {form.getValues('email')}. Open it to finish
                  creating your account.
                </AlertDescription>
              </div>
            </Alert>
          ) : null}

          {formError ? (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <div>
                <AlertTitle>{mode === 'sign-in' ? "Couldn't sign in" : "Couldn't sign up"}</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </div>
            </Alert>
          ) : null}

          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                aria-invalid={Boolean(form.formState.errors.email)}
                aria-describedby={form.formState.errors.email ? 'email-error' : undefined}
                {...form.register('email')}
              />
              {form.formState.errors.email ? (
                <p id="email-error" className="text-sm text-destructive">
                  {form.formState.errors.email.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                aria-invalid={Boolean(form.formState.errors.password)}
                aria-describedby={form.formState.errors.password ? 'password-error' : undefined}
                {...form.register('password')}
              />
              {form.formState.errors.password ? (
                <p id="password-error" className="text-sm text-destructive">
                  {form.formState.errors.password.message}
                </p>
              ) : null}
            </div>

            <Button
              type="submit"
              className="w-full"
              loading={form.formState.isSubmitting}
              loadingText={mode === 'sign-in' ? 'Signing in…' : 'Creating account…'}
            >
              {mode === 'sign-in' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <p className="text-sm text-muted-foreground">
            {mode === 'sign-in' ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              onClick={() => {
                setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
                setFormError(null);
                setConfirmationSent(false);
              }}
            >
              {mode === 'sign-in' ? 'Create one' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>

      <aside className="hidden items-center justify-center bg-primary-subtle px-8 py-12 lg:flex">
        <Card className="w-full max-w-md border-none shadow-card-hover">
          <CardContent className="space-y-6 p-8">
            <h2 className="text-lg font-semibold tracking-tight">
              Numbers you can actually explain
            </h2>
            <ul className="space-y-5">
              <ValueProp
                icon={TrendingUp}
                title="Spending that excludes your own transfers"
                description="Moving $2,000 to savings is not spending. Neither is paying off a card whose purchases are already counted."
              />
              <ValueProp
                icon={ShieldCheck}
                title="Every figure is traceable"
                description="Each total breaks down to the transactions behind it — gross debits, exclusions, refunds, result."
              />
              <ValueProp
                icon={Lock}
                title="Read-only bank access via Plaid"
                description="Cash Atlas can see balances and transactions. It cannot move money, and your bank credentials never reach it."
              />
            </ul>
          </CardContent>
        </Card>
      </aside>
    </main>
  );
}

function ValueProp({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </li>
  );
}
