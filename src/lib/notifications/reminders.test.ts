import { planReminders, type ReminderSettings } from '@/lib/notifications/reminders';

const strings = { dinnerTitle: 'Tonight', planWeekTitle: 'Plan next week', planWeekBody: 'Nothing planned yet.' };
const names: Record<string, string> = { tacos: 'Tacos', pasta: 'Pasta', oats: 'Oats' };
const dinnerName = (id: string) => names[id];

function plan(now: Date, settings: Partial<ReminderSettings>, entries: { scheduled_date: string; dinner_id: string; meal_type?: 'dinner' | 'breakfast' }[] = []) {
  return planReminders({
    now,
    settings: { dinner: false, dinnerTime: '16:00', planWeek: false, ...settings },
    entries: entries.map((entry) => ({ meal_type: 'dinner' as const, ...entry })),
    dinnerName,
    strings,
  });
}

// Wednesday 30 September 2026, 12:00 local time.
const wednesdayNoon = new Date(2026, 8, 30, 12, 0);

describe('dinner reminders', () => {
  it('schedules one for each coming day with a dinner planned, at the chosen time', () => {
    const reminders = plan(wednesdayNoon, { dinner: true, dinnerTime: '17:00' }, [
      { scheduled_date: '2026-09-30', dinner_id: 'tacos' },
      { scheduled_date: '2026-10-02', dinner_id: 'pasta' },
      { scheduled_date: '2026-10-02', dinner_id: 'oats', meal_type: 'breakfast' },
    ]);

    expect(reminders.map((r) => [r.at.getDate(), r.at.getHours(), r.body])).toEqual([
      [30, 17, 'Tacos'],
      [2, 17, 'Pasta'],
    ]);
    expect(reminders[0].week).toBe('2026-09-28');
  });

  it('skips tonight once the time has passed, and days beyond a week', () => {
    const evening = new Date(2026, 8, 30, 19, 0);
    const reminders = plan(evening, { dinner: true }, [
      { scheduled_date: '2026-09-30', dinner_id: 'tacos' },
      { scheduled_date: '2026-10-08', dinner_id: 'pasta' },
    ]);

    expect(reminders).toEqual([]);
  });

  it('changes id when the dinner changes, so the old reminder is replaced', () => {
    const before = plan(wednesdayNoon, { dinner: true }, [{ scheduled_date: '2026-09-30', dinner_id: 'tacos' }]);
    const after = plan(wednesdayNoon, { dinner: true }, [{ scheduled_date: '2026-09-30', dinner_id: 'pasta' }]);

    expect(before[0].id).not.toBe(after[0].id);
  });
});

describe('plan next week reminder', () => {
  it('nudges on Sunday evening while next week is empty', () => {
    const [reminder] = plan(wednesdayNoon, { planWeek: true });

    expect(reminder.at).toEqual(new Date(2026, 9, 4, 18, 0));
    expect(reminder.week).toBe('2026-10-05');
  });

  it('stays quiet once something is planned next week', () => {
    expect(plan(wednesdayNoon, { planWeek: true }, [{ scheduled_date: '2026-10-07', dinner_id: 'tacos' }])).toEqual([]);
  });

  it('moves to the following Sunday once this one has passed', () => {
    const [reminder] = plan(new Date(2026, 9, 4, 19, 0), { planWeek: true });

    expect(reminder.at).toEqual(new Date(2026, 9, 11, 18, 0));
  });
});
