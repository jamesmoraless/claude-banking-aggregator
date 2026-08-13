import { RouteNotImplemented } from '@/components/common/not-implemented';

export function TransferReviewPage() {
  return (
    <RouteNotImplemented
      title="Transfer Review"
      description="Confirm which transactions were movements between your own accounts."
      plannedWork={[
        'Side-by-side outgoing and incoming legs with the confidence score',
        'Confirm, reject, or choose a different match',
        'Explanation of which signals produced each confidence score',
      ]}
    />
  );
}
