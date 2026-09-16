This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Daily missing-response email (16 September 2026)

At 9:15 am IST every day, `bandwidth@indigoedge.com` emails only `ajder@indigoedge.com`. The subject starts `Bandwidth:` and includes the pending count and cycle date. Missing respondents appear first, with names, roles, and email addresses. Other recipients appear below in a compact reference list.

Monday reports the previous Monday-to-Sunday cycle. Other days report the current cycle. The production cycle's tokens define the cohort; `not_needed` is an exemption. Completed cycles remain readable. This daily snapshot is separate from Monday deadline-compliance classifications, peer reports, conflict resolution, and director sign-off.

The authenticated `/api/cron/submission-status` endpoint runs at 03:45 UTC, with a 03:50 UTC retry. `?preview=true` is read-only. The additive `daily_submission_reports` table freezes each daily payload and stores its delivery receipt. Details: [daily-submission-status.md](docs/operations/daily-submission-status.md).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
