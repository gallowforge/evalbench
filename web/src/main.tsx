import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isNotFound } from './components/ui';
import './index.css';
import { startTheme } from './lib/theme';

startTheme();

const client = new QueryClient({
  // A 404 will not change on a second try, so it shows at once.
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: (n, e) => !isNotFound(e) && n < 1, staleTime: 5_000 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
