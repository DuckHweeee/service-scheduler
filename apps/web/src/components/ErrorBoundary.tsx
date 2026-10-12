import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface State {
  failed: boolean;
}

/** Last line of defence: a render crash shows a plain message and a way back instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Screen crashed', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 20px' }}>
        <div role="alert">
          <h1 style={{ fontSize: 24, margin: '0 0 12px' }}>Something went wrong on this page.</h1>
          <p style={{ margin: '0 0 20px' }}>Nothing was lost. Go back to booking and try again.</p>
          <a href="/book" style={{ fontWeight: 700, color: 'var(--accent)' }}>
            Go back to booking
          </a>
        </div>
      </main>
    );
  }
}
