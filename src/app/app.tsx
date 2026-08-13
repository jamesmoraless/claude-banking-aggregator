import { BrowserRouter } from 'react-router-dom';

import { ConfigurationRequired } from '@/components/common/configuration-required';
import { envResult } from '@/config/env';

import { Providers } from './providers';
import { AppRoutes } from './routes';

/**
 * Application root.
 *
 * Configuration is checked before anything else mounts. Without valid Supabase
 * credentials there is no honest version of this UI to render — Cash Atlas has
 * no demo data to fall back to — so it shows exactly what is missing instead.
 */
export function App() {
  if (!envResult.ok) {
    return <ConfigurationRequired issues={envResult.issues} />;
  }

  return (
    <Providers>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </Providers>
  );
}
