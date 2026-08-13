import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { describeError, EmptyState, ErrorState, NoResultsState, ZeroState } from '../states';

/**
 * These states carry real weight in Cash Atlas, because nothing is ever
 * fabricated to fill a screen. Confusing "you have no data" with "your filters
 * excluded everything" is the classic way an empty state misleads.
 */
describe('EmptyState', () => {
  it('renders its message and call to action', () => {
    render(
      <EmptyState
        title="No institutions connected"
        description="Connect your first bank to see your overview."
        action={<button type="button">Connect institution</button>}
      />,
    );

    expect(screen.getByText('No institutions connected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect institution' })).toBeInTheDocument();
  });
});

describe('NoResultsState', () => {
  it('says the filters excluded everything, not that there is no data', () => {
    render(<NoResultsState entity="transactions" />);

    expect(screen.getByText('No transactions match these filters')).toBeInTheDocument();
    // Must not imply the account is empty.
    expect(screen.queryByText(/no transactions available/i)).not.toBeInTheDocument();
  });

  it('offers to clear the filters', async () => {
    const onClear = vi.fn();
    render(<NoResultsState onClear={onClear} />);

    await userEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});

describe('ZeroState', () => {
  /**
   * A legitimate $0 must not look like a component that failed to load, so it
   * renders the figure explicitly alongside an explanation.
   */
  it('shows the zero as a real figure with an explanation', () => {
    render(
      <ZeroState
        title="No spending recorded this month"
        description="You have transactions, but none of them counted as spending."
      />,
    );

    expect(screen.getByText('$0.00')).toBeInTheDocument();
    expect(screen.getByText('No spending recorded this month')).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('offers a retry and invokes it', async () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('does not render raw exception detail', () => {
    render(
      <ErrorState
        error={new Error('select * from transactions where user_id = 42 -- internal detail')}
      />,
    );

    expect(screen.queryByText(/select \* from/i)).not.toBeInTheDocument();
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });
});

describe('describeError', () => {
  it('explains missing configuration actionably', () => {
    expect(describeError({ code: 'SUPABASE_NOT_CONFIGURED' })).toContain('MANUAL_SETUP.md');
  });

  it('explains an expired session', () => {
    expect(describeError({ name: 'AuthSessionMissingError' })).toContain('session expired');
    expect(describeError({ code: 'PGRST301' })).toContain('session expired');
  });

  it('explains a missing database function as a migration problem', () => {
    expect(describeError({ code: 'PGRST202' })).toContain('migrations');
  });

  it('explains a permission failure without leaking detail', () => {
    expect(describeError({ code: '42501' })).toBe('You do not have access to this data.');
  });

  it('falls back to a safe message for anything unrecognised', () => {
    expect(describeError({ code: 'SOMETHING_ODD', message: 'internal table xyz missing' })).toBe(
      'Something went wrong on our side. Please try again.',
    );
  });

  it('handles a null error', () => {
    expect(describeError(null)).toContain('Something went wrong');
  });
});
