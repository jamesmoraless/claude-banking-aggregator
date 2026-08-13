import { RouteNotImplemented } from '@/components/common/not-implemented';

export function ChatPage() {
  return (
    <RouteNotImplemented
      title="Atlas AI"
      description="Ask questions about your finances."
      plannedWork={[
        'finance-chat Edge Function with Claude tool calling',
        'Read-only financial tools executed server-side and scoped to your data',
        'Structured answers: metric cards, charts, transaction tables and calculation breakdowns',
      ]}
    />
  );
}
