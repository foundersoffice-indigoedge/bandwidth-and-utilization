# Daily submission status email

Ajder receives a separate email from this system at 9:15 am IST every day, including weekends. It goes only to `ajder@indigoedge.com`, with no CC.

The email leads with missing submissions and their names, roles, and email addresses. It includes cycle dates, totals, the observation time, and a compact list of other recipients. It still sends when everyone has submitted.

On the rollout morning, the email summarizes the previous cycle: Friday for project check-ins and Monday for bandwidth. All other mornings report the current cycle. The summary uses the submission status recorded when the report is prepared, including late submissions received by then.

Check-in obligations come from Airtable's Check in Cycles records, including VP/AVP leads. Confirmed and Updated count as submitted. Bandwidth obligations come from the production cycle's tokens; not_needed is an exemption. Completed bandwidth cycles remain readable. Missing or ambiguous cycle data produces a data-attention email.

`GET /api/cron/submission-status` requires the existing cron bearer secret. `?preview=true` returns the report without sending or writing. The schedule is 03:45 UTC, with a 03:50 UTC retry. The delivery log freezes the first email payload and records the provider message ID; retries reuse the same daily key and body. A successful send isn't repeated. A provider failure stays retryable.

Apply the additive daily_submission_reports migration before deployment. The table stores email payloads and delivery receipts only; it doesn't change any submission records. To disable these emails, remove the two submission-status cron entries and redeploy.
