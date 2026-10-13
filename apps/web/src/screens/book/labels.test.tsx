import type { AvailabilitySlot, SlotStatus } from '@scheduler/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SlotGrid } from './SlotGrid.js';
import { slotAriaLabel, slotLabel } from './labels.js';

const slot = (startTime: string, status: SlotStatus, isExpress = false): AvailabilitySlot => ({
  startTime,
  endTime: '10:00',
  startAt: `2026-10-09T${startTime}:00+07:00`,
  status,
  isExpress,
  proposed:
    status === 'AVAILABLE'
      ? {
          serviceBay: { id: 'BAY-01', name: 'Bay 1', bayType: 'GENERAL_LIFT' },
          technician: { id: 'TEC-03', name: 'Riya Patel' },
        }
      : null,
});

describe('slot status mapping', () => {
  const cases: [SlotStatus, boolean, string][] = [
    ['AVAILABLE', false, 'Free'],
    ['AVAILABLE', true, 'Express'],
    ['NO_QUALIFIED_TECHNICIAN', false, 'No technician'],
    ['NO_BAY', false, 'No bay'],
    ['FULLY_BOOKED', false, 'Booked up'],
    ['SAME_DAY_QUOTA_REACHED', true, 'Today is full'],
  ];
  it.each(cases)('%s (express=%s) → "%s"', (status, express, label) => {
    expect(slotLabel({ status, isExpress: express })).toBe(label);
    expect(slotAriaLabel({ startTime: '08:00', endTime: '10:00', status, isExpress: express })).toBe(
      `08:00 to 10:00, ${label}`,
    );
  });

  it('renders available slots as enabled buttons and the rest as disabled buttons with a reason in aria-label', () => {
    render(
      <SlotGrid
        selectedStart="08:00"
        onPick={() => undefined}
        slots={[
          slot('08:00', 'AVAILABLE'),
          slot('08:30', 'NO_QUALIFIED_TECHNICIAN'),
          slot('09:00', 'NO_BAY'),
          slot('09:30', 'FULLY_BOOKED'),
          slot('10:00', 'SAME_DAY_QUOTA_REACHED', true),
        ]}
      />,
    );
    const picked = screen.getByRole('button', { name: '08:00 to 10:00, Free' });
    expect(picked).toBeEnabled();
    expect(picked).toHaveAttribute('aria-pressed', 'true');
    for (const reason of ['No technician', 'No bay', 'Booked up', 'Today is full']) {
      const b = screen.getByRole('button', { name: new RegExp(`, ${reason}$`) });
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute('aria-pressed', 'false');
      expect(b).toHaveTextContent(reason);
    }
  });
});
