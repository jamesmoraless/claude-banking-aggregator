import { RouteNotImplemented } from '@/components/common/not-implemented';

export function SettingsPage() {
  return (
    <RouteNotImplemented
      title="Settings"
      description="Profile, connections, accounts, rules and sync status."
      plannedWork={[
        'Base currency and timezone',
        'Per-institution connection status with reconnect, refresh and disconnect',
        'Transaction rules and transfer overrides',
      ]}
    />
  );
}
