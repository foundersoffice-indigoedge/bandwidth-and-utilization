import type { VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  framework: 'nextjs',
  crons: [
    {
      // Every Monday at 9:00 AM IST (3:30 AM UTC)
      path: '/api/cron/start-cycle',
      schedule: '30 3 * * 1',
    },
    {
      // Every weekday (Tue-Fri) at 9:00 AM IST (3:30 AM UTC)
      path: '/api/cron/send-reminders',
      schedule: '30 3 * * 2-5',
    },
  ],
};
