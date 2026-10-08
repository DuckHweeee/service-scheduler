import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('wave 0 smoke', () => {
  it('renders', () => {
    render(<p>hello</p>);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });
});
