import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.js';
import { USE_MOCKS } from './config.js';
import './styles/global.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

async function enableMocking() {
  if (!USE_MOCKS) return;
  const { worker } = await import('./mocks/browser.js');
  await worker.start({ onUnhandledRequest: 'bypass', serviceWorker: { url: '/mockServiceWorker.js' } });
}

void enableMocking()
  .catch((err: unknown) => console.error('Could not start the MSW worker; continuing without mocks.', err))
  .then(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </StrictMode>,
    );
  });
