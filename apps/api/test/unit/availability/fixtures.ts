import type { BayType, Skill } from '@scheduler/contracts';
import type { BayState, DayContext, Interval, ServiceSpec, TechnicianState } from '../../../src/domain/availability/index.js';

/** 'HH:MM' -> minutes since midnight. */
export const hm = (s: string): number => {
  const [h, m] = s.split(':').map(Number);
  return h! * 60 + m!;
};
/** 'HH:MM-HH:MM' -> Interval. */
export const iv = (s: string): Interval => {
  const [a, b] = s.split('-');
  return { start: hm(a!), end: hm(b!) };
};

export const ALL_DAY = '08:00-17:00';

const BAYS: Array<[string, string, BayType]> = [
  ['BAY-01', 'Bay 1', 'GENERAL_LIFT'],
  ['BAY-02', 'Bay 2', 'GENERAL_LIFT'],
  ['BAY-03', 'Bay 3', 'ALIGNMENT_RACK'],
  ['BAY-04', 'Bay 4', 'EV_ISOLATED'],
  ['BAY-05', 'Bay 5', 'WASH_BAY'],
];
const TECHS: Array<[string, string, Skill[]]> = [
  ['TEC-01', 'An Nguyen', ['GENERAL', 'BRAKES', 'EV_HIGH_VOLTAGE']],
  ['TEC-02', 'Marco Ortiz', ['GENERAL', 'ALIGNMENT']],
  ['TEC-03', 'Riya Patel', ['GENERAL', 'BRAKES']],
  ['TEC-04', 'Jin Kim', ['GENERAL', 'EV_HIGH_VOLTAGE']],
];

const svc = (code: string, durationMin: number, requiredSkill: Skill, allowedBayTypes: BayType[]): ServiceSpec => ({
  code,
  durationMin,
  requiredSkill,
  allowedBayTypes,
});
const LIFT_OR_RACK: BayType[] = ['GENERAL_LIFT', 'ALIGNMENT_RACK'];

export const SERVICES = {
  OIL_CHANGE: svc('OIL_CHANGE', 45, 'GENERAL', LIFT_OR_RACK),
  GENERAL_INSPECTION: svc('GENERAL_INSPECTION', 30, 'GENERAL', LIFT_OR_RACK),
  AIR_FILTER_REPLACEMENT: svc('AIR_FILTER_REPLACEMENT', 30, 'GENERAL', LIFT_OR_RACK),
  TIRE_ROTATION: svc('TIRE_ROTATION', 45, 'GENERAL', LIFT_OR_RACK),
  CAR_WASH: svc('CAR_WASH', 30, 'GENERAL', ['WASH_BAY']),
  BRAKE_PAD_REPLACEMENT: svc('BRAKE_PAD_REPLACEMENT', 120, 'BRAKES', LIFT_OR_RACK),
  WHEEL_ALIGNMENT: svc('WHEEL_ALIGNMENT', 60, 'ALIGNMENT', ['ALIGNMENT_RACK']),
  EV_BATTERY_CHECK: svc('EV_BATTERY_CHECK', 90, 'EV_HIGH_VOLTAGE', ['EV_ISOLATED']),
} as const;
export const ALL_SERVICES: ServiceSpec[] = Object.values(SERVICES);

export interface DayOpts {
  /** Busy intervals per resource id (bay or technician), as 'HH:MM-HH:MM'. */
  busy?: Record<string, string[]>;
  isWorkingDay?: boolean;
  sameDay?: { earliestStart: string; quotaCap: number; sameDayBusy?: string[] };
}

/** DLR-01 seed (SPEC §7): 5 bays, 4 technicians, 08:00-17:00. */
export const makeDlr01Day = (opts: DayOpts = {}): DayContext => {
  const busyOf = (id: string): Interval[] => (opts.busy?.[id] ?? []).map(iv);
  const bays: BayState[] = BAYS.map(([id, name, bayType]) => ({ id, name, bayType, busy: busyOf(id) }));
  const technicians: TechnicianState[] = TECHS.map(([id, name, skills]) => ({
    id,
    name,
    skills,
    busy: busyOf(id),
  }));
  return {
    opensAt: hm('08:00'),
    closesAt: hm('17:00'),
    isWorkingDay: opts.isWorkingDay ?? true,
    bays,
    technicians,
    sameDay: opts.sameDay
      ? {
          earliestStart: hm(opts.sameDay.earliestStart),
          quotaCap: opts.sameDay.quotaCap,
          sameDayBusy: (opts.sameDay.sameDayBusy ?? []).map(iv),
        }
      : null,
  };
};
