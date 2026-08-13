import { Construction } from 'lucide-react';

import { PageHeader } from '@/components/common/page-header';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Honest placeholder for a screen that has not been built yet.
 *
 * It renders nothing that resembles financial data. The alternative — a screen
 * populated with sample balances — would be indistinguishable from a working
 * feature until someone trusted a fabricated number.
 */
export function RouteNotImplemented({
  title,
  description,
  plannedWork,
}: {
  title: string;
  description: string;
  plannedWork: string[];
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <Card>
        <CardContent className="flex flex-col items-center gap-4 px-6 py-14 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Construction className="size-5" aria-hidden="true" />
          </span>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">This screen is not built yet</p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              It is deliberately empty rather than filled with sample data. The schema, queries and
              calculations it depends on are already in place.
            </p>
          </div>
          <ul className="mx-auto max-w-md space-y-1 text-left text-sm text-muted-foreground">
            {plannedWork.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden="true">·</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
