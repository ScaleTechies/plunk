# Gameplan: ZeptoMail-Only Plunk Fork

## 1. Goal

We want a lightweight, self-hostable, event-driven email automation system that fits our Coolify VPS setup better than Dittofeed.

The target system should give us:

- Event-triggered workflows
- Branching automations
- Wait-for-event logic
- Transactional/lifecycle emails
- Contact-based journeys
- Webhook steps for SMS, push, WhatsApp, or backend actions
- ZeptoMail as the actual email delivery provider
- No dependency on Amazon SES
- No ClickHouse/Temporal-heavy stack like Dittofeed

The working idea is:

Plunk fork
→ remove practical dependency on SES
→ replace SES sending/tracking/webhook behavior with ZeptoMail equivalents
→ run the fork on Coolify
→ use ZeptoMail for delivery
→ use Plunk workflows as the automation brain

This is a private fork. We are not trying to upstream it.

---

## 2. Why Plunk

Plunk is attractive because it gives us a much lighter stack than Dittofeed while still supporting the pieces we actually care about:

- Projects/brands separation
- API-triggered events
- Contacts
- Templates
- Campaign-style sending
- Workflows
- Wait-for-event steps
- Conditional branches
- Webhook steps
- Email sending
- Tracking/analytics

For our use case, Plunk sits in the sweet spot between tools that are too simple and tools that are too heavy.

Too simple:

- Listmonk
- Backend-only email jobs

Too heavy:

- Dittofeed
- Mautic
- Full customer data/journey platforms

Plunk is not a full Customer.io/Braze clone, but for ConvoScale and ScaleTechies lifecycle automation, it is likely enough.

---

## 3. Why Not SES

Self-hosted Plunk is currently strongly tied to Amazon SES. It expects SES for sending, domain verification, delivery tracking, bounce handling, complaint handling, quota checks, and SNS webhooks.

That is a problem because SES rejected us.

Even aside from rejection, SES adds AWS friction we do not want right now:

- Production access approval
- SES regions
- IAM credentials
- SNS setup
- Configuration sets
- AWS-specific delivery events
- More operational weirdness

ZeptoMail is already more practical for us.

So the fork should become:

ZeptoMail-only Plunk

Not:

Plunk with SES and ZeptoMail support

We do not need multi-provider elegance yet. We need something that works, stays light, and can be maintained.

---

## 4. Core Strategy

We will not rewrite Plunk.

The winning strategy is:

Keep Plunk’s workflow/product logic intact.
Replace the SES delivery layer with ZeptoMail.
Touch as few files as possible.
Avoid schema changes unless absolutely necessary.

The goal is to preserve:

- Workflow engine
- Campaign logic
- Contact logic
- Event tracking
- Template rendering
- Project separation
- API behavior
- Queue/email processor

And replace only the provider-specific layer:

- SES send call
- SES quota call
- SES/SNS webhook handling
- SES domain verification assumptions
- SES env vars

This gives us the fastest usable fork and keeps future Plunk updates manageable.

---

## 5. Repo Areas We Expect to Touch

Main files:

apps/api/src/services/SESService.ts
apps/api/src/services/EmailService.ts
apps/api/src/services/DomainService.ts
apps/api/src/controllers/Webhooks.ts
apps/api/src/jobs/email-processor.ts
apps/api/src/app/constants.ts
.env.self-host.example
docker / compose env examples

Expected philosophy:

Touch SESService heavily.
Touch Webhooks moderately.
Touch DomainService moderately.
Touch constants/env moderately.
Avoid touching EmailService unless forced.
Avoid touching workflow/campaign/contact/event services.

The most important thing: do not disturb EmailService unless necessary.

That file already does useful Plunk work before sending:

- Checks email status
- Checks subscription/unsubscribe state
- Verifies sending domain
- Renders variables
- Builds HTML
- Adds unsubscribe footer
- Handles headers
- Handles attachments
- Sets tracking mode
- Calls provider send function
- Stores provider message ID
- Tracks email.sent

We want to preserve all that.

---

## 6. Phase 1 — Make Sending Work

### Objective

Get Plunk sending emails through ZeptoMail instead of SES.

### Main file

apps/api/src/services/SESService.ts

At first, we can keep the filename and exported function names to reduce blast radius.

Internally, it becomes ZeptoMail-backed.

### Replace SES send behavior

Old model:

Plunk builds raw MIME
SES sendRawEmail()
SES returns message ID

New model:

Plunk prepares email data
ZeptoMail /v1.1/email API sends it
ZeptoMail returns request/message reference
Plunk stores that as provider message ID

### Required ZeptoMail env vars

ZEPTOMAIL_SEND_TOKEN=
ZEPTOMAIL_API_URL=https://api.zeptomail.com/v1.1/email
ZEPTOMAIL_DEFAULT_FROM_DOMAIN=
EMAIL_RATE_LIMIT_PER_SECOND=2
EMAIL_DAILY_LIMIT=5000
EMAIL_WORKER_CONCURRENCY=2
EMAIL_WORKER_MAX_CONCURRENCY=5

### Map Plunk email fields to ZeptoMail

from          → from.address / from.name
to            → to[].email_address.address
cc            → cc[].email_address.address
bcc           → bcc[].email_address.address
reply_to      → reply_to[]
subject       → subject
HTML body     → htmlbody
text body     → textbody
headers       → mime_headers
attachments   → attachments[]
inline images → inline_images[]
tracking      → track_opens / track_clicks
Plunk email ID → client_reference

### Critical choice

Use:

client_reference = Plunk internal email record ID

That will make webhook mapping much easier later.

### MVP success test

Trigger a Plunk email and confirm:

Plunk workflow/API sends email
ZeptoMail accepts request
Recipient receives email
Plunk marks email as sent
Provider message/reference is stored

At this phase, opens/clicks/bounces do not need to work yet.

---

## 7. Phase 2 — Remove SES Env Dependency

### Objective

Stop Plunk from requiring AWS SES credentials.

### Main file

apps/api/src/app/constants.ts

Remove or relax required SES env vars:

AWS_SES_REGION
AWS_SES_ACCESS_KEY_ID
AWS_SES_SECRET_ACCESS_KEY
SES_CONFIGURATION_SET
SES_CONFIGURATION_SET_NO_TRACKING

Replace with ZeptoMail envs.

### Keep rate limits simple

If Plunk asks for SES quota, return static/env-driven values.

Example behavior:

getSendingQuota()
→ maxSendRate = EMAIL_RATE_LIMIT_PER_SECOND
→ max24HourSend = EMAIL_DAILY_LIMIT
→ sentLast24Hours = 0 or estimated internally

We do not need perfect quota syncing in v1.

The important thing is not overwhelming ZeptoMail.

---

## 8. Phase 3 — Domain Verification Strategy

### Objective

Avoid getting stuck rebuilding ZeptoMail domain management too early.

### MVP approach

Use manual domain verification.

Flow:

1. Verify sending domain inside ZeptoMail manually.
2. Add the same domain inside Plunk.
3. Plunk trusts the domain.
4. Emails send through ZeptoMail.

### Why manual first

ZeptoMail domain APIs exist, but they require OAuth scopes, not just the send-mail token.

That means fully automated domain verification would require:

- OAuth app
- Refresh token handling
- Domain creation API
- Domain verification API
- DNS record display
- Status checks

That is useful later, but not needed for MVP.

### Plunk behavior for MVP

Either:

A. Mark domains as verified manually in DB/admin flow

or:

B. Stub verification functions to return success for private use

Option B is acceptable only if public signups are disabled.

### Security warning

Do not allow random users to create sending domains on this fork.

For private use:

Disable public registration.
Only our team creates projects/domains.

---

## 9. Phase 4 — Add ZeptoMail Webhook Handling

### Objective

Make Plunk understand ZeptoMail delivery events.

This is what makes the fork feel like a real email platform instead of just “send and pray.”

### Main file

apps/api/src/controllers/Webhooks.ts

Add a new endpoint:

POST /webhooks/zeptomail

Do not force ZeptoMail to pretend to be AWS SNS.

### ZeptoMail events to map

delivered      → EmailStatus.DELIVERED
open           → EmailStatus.OPENED / email.open
click          → EmailStatus.CLICKED / email.click
soft bounce    → EmailStatus.BOUNCED, but maybe do not suppress immediately
hard bounce    → EmailStatus.BOUNCED + suppress/unsubscribe
feedback loop  → EmailStatus.COMPLAINED + suppress/unsubscribe
failed         → EmailStatus.FAILED

### Matching strategy

First choice:

client_reference

Fallbacks:

request_id
email_reference
provider message ID
recipient + timestamp if desperate

This is why Phase 1 must set client_reference properly.

### Webhook security

Add:

ZEPTOMAIL_WEBHOOK_AUTH_KEY=
ZEPTOMAIL_WEBHOOK_MAX_AGE_SECONDS=300

Validate ZeptoMail webhook signature before processing events.

Do not skip this.

Without signature validation, anyone could fake opens, bounces, complaints, or delivery events.

---

## 10. Phase 5 — Bounce and Complaint Suppression

### Objective

Protect deliverability.

When a hard bounce or complaint happens, Plunk must stop sending to that contact.

### MVP behavior

Inside Plunk:

hard bounce
→ mark email bounced
→ mark/suppress/unsubscribe contact

feedback loop / complaint
→ mark email complained
→ mark/suppress/unsubscribe contact

### Later behavior

Use ZeptoMail suppression API too:

hard bounce / complaint
→ suppress in Plunk
→ also add to ZeptoMail suppression list

This may require ZeptoMail OAuth access, so it can be delayed.

MVP Plunk-side suppression is enough to avoid repeatedly emailing bad addresses from our own system.

---

## 11. Phase 6 — Tracking

### Objective

Map Plunk tracking preference to ZeptoMail tracking flags.

ZeptoMail supports:

track_opens
track_clicks

So Plunk’s old SES configuration-set behavior can become:

tracking enabled
→ track_opens = true
→ track_clicks = true

tracking disabled
→ track_opens = false
→ track_clicks = false

This is cleaner than SES configuration sets.

---

## 12. Phase 7 — Webhook Steps for SMS, Push, WhatsApp

### Objective

Use Plunk as the workflow brain, not just an email sender.

Plunk can call external HTTP endpoints from workflows.

That lets us do:

Plunk workflow
→ webhook to ConvoScale backend
→ backend sends SMS via Termii/Twilio/Africa’s Talking

or:

Plunk workflow
→ webhook to backend
→ backend sends push via Firebase/OneSignal

or:

Plunk workflow
→ webhook to backend
→ backend sends WhatsApp via provider

### Important pattern

External channel events should be tracked back into Plunk:

sms_sent
sms_failed
push_sent
push_clicked
whatsapp_delivered

That allows workflows to continue based on what happened.

---

## 13. What We Will Not Build in V1

To keep this sane, v1 will not include:

- SES support
- Multi-provider abstraction
- Automatic ZeptoMail domain verification
- ZeptoMail OAuth management
- ZeptoMail logs reconciliation
- Full suppression API sync
- Provider settings UI
- Major Plunk schema changes
- Big UI rewrites
- Inbound email receiving
- Newsletter/promotional blasting

V1 is strictly:

Plunk workflows + ZeptoMail transactional/lifecycle sending.

---

## 14. ZeptoMail Usage Boundary

ZeptoMail is transactional-email-focused.

So we should use this fork for:

- Welcome emails
- Account verification
- Password reset / magic link
- Trial onboarding
- Setup reminders
- Payment failure reminders
- Invoice/payment notices
- Product activity alerts
- Lead notifications
- Lifecycle nudges based on product behavior

Avoid using it for:

- Cold outreach
- Purchased lists
- General newsletters
- Promotional blasts
- Mass marketing campaigns
- Affiliate offers

For promotional/newsletter-style sending, we should use a separate tool/provider later.

This fork is for lifecycle and transactional automation.

---

## 15. Coolify Deployment Plan

### Services

Expected stack:

Plunk app
Postgres
Redis
External ZeptoMail

No ClickHouse.

No Temporal.

No SES.

No self-hosted SMTP.

### Coolify approach

Use Docker Compose / custom image.

Build our own image:

ghcr.io/scaletechies/plunk-zeptomail:vX.Y.Z-zm.1

Version format:

official Plunk version + our patch version

Examples:

plunk-zeptomail:v0.7.0-zm.1
plunk-zeptomail:v0.7.0-zm.2
plunk-zeptomail:v0.8.0-zm.1

Do not use latest.

### VPS expectations

This should be much lighter than Dittofeed.

Expected shape:

Plunk app container
Postgres
Redis

This should be acceptable on an 8GB VPS with other light/moderate services, as long as we monitor RAM.

---

## 16. Update Strategy

We maintain a private fork.

### Git setup

origin    → our fork
upstream  → official Plunk repo

### Branches

Simple version:

main
→ our ZeptoMail fork

upstream/main
→ official Plunk

Update process:

git fetch upstream
git checkout main
git merge upstream/main
# resolve conflicts
# run build/tests
# build Docker image
# deploy staging
# test email flows
# deploy production

Prefer official release tags if available:

git fetch upstream --tags
git merge v0.x.x

### What will conflict most often

Likely:

SESService.ts
Webhooks.ts
DomainService.ts
constants.ts
email-processor.ts

That is acceptable.

If conflicts start appearing all over the repo, we touched too much.

---

## 17. Staging Plan

We should run:

plunk-staging.domain.com

Before production:

plunk.domain.com

Every update must be tested in staging first.

### Staging checklist

Login works
Project selection works
API keys work
Contact creation works
Event tracking works
Workflow triggers
Email sends through ZeptoMail
ZeptoMail webhook updates delivery/open/click
Hard bounce suppresses contact
Complaint suppresses contact
Unsubscribe works
Campaign/lifecycle send works
Webhook workflow step works

---

## 18. Tests We Should Add

Minimum useful tests:

send basic email
send HTML email
send text fallback
send with reply-to
send with custom headers
send with attachment
send with tracking enabled
send with tracking disabled
send failure from ZeptoMail
parse delivered webhook
parse open webhook
parse click webhook
parse hard bounce webhook
parse complaint webhook
reject invalid webhook signature
ignore duplicate webhook events

Even a small test set will protect us during Plunk updates.

---

## 19. Rollback Plan

Before major updates:

Backup Postgres
Record current Docker image tag
Export current env vars
Check current Plunk fork commit

If update fails:

Switch Coolify image back to previous tag
Restore DB only if migration broke compatibility

Important: database migrations can make rollback harder.

So before any major upstream Plunk update, backup first.

---

## 20. MVP Milestones

### Milestone 1: Email sends through ZeptoMail

Success:

Plunk can send one test email through ZeptoMail.

### Milestone 2: Workflow email sends

Success:

A Plunk workflow triggered by an event sends an email through ZeptoMail.

### Milestone 3: Wait-for-event branching works

Success:

signed_up
→ wait for chatbot_installed
→ if installed, send success email
→ if timeout, send setup reminder

### Milestone 4: ZeptoMail webhook tracking works

Success:

delivered/open/click/bounce/complaint events update Plunk.

### Milestone 5: Bounce/complaint suppression works

Success:

Hard-bounced or complaint contacts stop receiving future emails.

### Milestone 6: Production Coolify deployment

Success:

Stable Plunk-ZeptoMail fork running on our VPS with ConvoScale and ScaleTechies projects.

---

## 21. Example ConvoScale Flows

### Signup onboarding

user_signed_up
↓
Send welcome email
↓
Wait 24h for project_created
   ├─ yes → send chatbot setup email
   └─ no → send “create your first project” reminder

### Chatbot installation

project_created
↓
Wait 24h for chatbot_installed
   ├─ yes → send “your chatbot is live” email
   └─ no → send install help email

### Lead activation

chatbot_installed
↓
Wait 7 days for lead_created
   ├─ yes → send “you got your first lead” email
   └─ no → send “improve your widget placement” email

### Payment failure

subscription_payment_failed
↓
Send payment failed email
↓
Wait 48h for subscription_payment_recovered
   ├─ yes → send payment restored email
   └─ no → send second reminder
↓
Wait 72h
   ├─ recovered → exit
   └─ not recovered → webhook backend to pause account

### Support escalation

chatbot_not_installed_after_72h
↓
Send email
↓
Webhook to ConvoScale backend
↓
Create internal support task

---

## 22. Final Architecture

ConvoScale / ScaleTechies apps
↓
Track user/product events into Plunk
↓
Plunk contacts + workflows + conditions + wait-for-event logic
↓
Plunk sends lifecycle/transactional emails through ZeptoMail
↓
ZeptoMail delivers email
↓
ZeptoMail webhooks return delivery/open/click/bounce/complaint events
↓
Plunk updates email status, analytics, and contact suppression
↓
Plunk webhook steps can call our backend for SMS/push/WhatsApp/actions

---

## 23. Final Decision

We proceed with a ZeptoMail-only Plunk fork.

Not a clean multi-provider rewrite.

Not Dittofeed.

Not Mautic.

Not Listmonk.

The first version should be a controlled, practical fork:

Minimal touched files
No SES support
ZeptoMail send API
Manual domain verification
Env-based rate limits
ZeptoMail webhook endpoint
Bounce/complaint suppression
Coolify deployment

This gives us the thing we actually wanted:

Lightweight self-hosted event-driven automation
+
Workflow branching
+
Wait-for-event logic
+
ZeptoMail delivery
+
Coolify-friendly deployment
+
No SES drama
+
No Dittofeed infrastructure baggage

---

## 24. Codebase Validation Updates

After checking the current Plunk fork, the plan is still valid, but the implementation scope needs a few corrections.

### 24.1 Manual domain verification is the MVP path

We can and should use manual ZeptoMail domain verification for v1.

The MVP domain flow should be:

1. Verify the sending domain manually inside ZeptoMail.
2. Add the same domain to Plunk.
3. Mark the domain as verified in Plunk without calling SES.
4. Only allow trusted/admin users to add domains.

This avoids ZeptoMail OAuth/domain-management work in v1.

Current code reality:

- `DomainService.addDomain()` currently calls SES immediately through `verifyDomain()`.
- `DomainService.checkVerification()` currently polls SES DKIM status.
- The scheduled domain verification worker also polls SES.
- `DomainService.removeDomain()` tries to delete the SES identity.
- The dashboard domain UI currently displays Amazon SES DKIM, MAIL FROM, SPF, and inbound MX records.

Required v1 changes:

- Stop calling SES from domain add/check/delete paths.
- Store newly added domains as verified only if we are comfortable with private/admin-only operation, or add a simple admin/manual verification path.
- Disable or simplify the scheduled domain verification job.
- Hide or replace SES DNS instructions in the dashboard.
- Keep `DomainService.verifyEmailDomain()` because it is still useful: it prevents sending from domains not registered to the project.

For this private fork, the simplest acceptable approach is:

domain added by trusted admin
-> Plunk records it as verified
-> ZeptoMail is treated as the source of truth for actual DNS verification

This is acceptable only with public signups disabled.

### 24.2 Sending path correction

The main runtime send path is the email worker:

`apps/api/src/jobs/email-processor.ts`

That worker imports:

`getSendingQuota, sendRawEmail` from `apps/api/src/services/SESService.ts`

So Phase 1 should focus on:

- Replacing `SESService.sendRawEmail()` internals with ZeptoMail.
- Replacing `SESService.getSendingQuota()` with env/static quota values.
- Updating `email-processor.ts` to pass the Plunk email record ID into `sendRawEmail()`.

The important addition:

`client_reference = email.id`

ZeptoMail supports `client_reference`, and ZeptoMail webhooks include it. This should be the primary webhook matching key.

The current `sendRawEmail()` signature does not receive `email.id`, so we need one small interface change:

```ts
clientReference?: string;
```

Then the worker sends:

```ts
clientReference: email.id
```

`EmailService.sendEmail()` also contains a direct send implementation, but it appears to be mostly test/legacy code. Keep it working if tests depend on it, but the worker is the production path.

### 24.3 Extra send path: campaign test emails

`CampaignService.sendTest()` also calls `sendRawEmail()` directly.

That means the provider replacement must cover campaign test sends too.

For test sends, `client_reference` can be omitted or set to a generated non-email-record value, because test sends do not create an `Email` row.

### 24.4 ZeptoMail API mapping confirmed

The planned ZeptoMail send mapping is broadly correct.

Use:

- `POST https://api.zeptomail.com/v1.1/email`
- `Authorization: Zoho-enczapikey <send-mail-token>`
- `from.address`
- `from.name`
- `to[].email_address.address`
- `to[].email_address.name`
- `reply_to[]`
- `subject`
- `htmlbody`
- `textbody` if we add a text fallback later
- `mime_headers`
- `attachments`
- `inline_images`
- `track_opens`
- `track_clicks`
- `client_reference`

Important note:

ZeptoMail is transactional-email-focused. This reinforces the existing usage boundary: lifecycle, onboarding, product, billing, and account emails are fine; newsletters/promotional blasts should stay out of this fork.

### 24.5 Webhook correction

Add a new endpoint:

`POST /webhooks/zeptomail`

Do not reuse `/webhooks/sns`.

The current SNS endpoint is deeply AWS-specific:

- AWS SNS signature verification
- SNS subscription confirmation
- nested `Message` JSON parsing
- SES event names
- SES `mail.messageId` lookup
- SES inbound email behavior

ZeptoMail webhook handling should be separate.

Primary matching strategy:

1. `event_message.email_info.client_reference` -> Plunk `email.id`
2. `event_message.email_info.email_reference`
3. `event_message.request_id`
4. stored provider `messageId`

The webhook should map:

- delivered -> `EmailStatus.DELIVERED`
- email opens -> `EmailStatus.OPENED`
- email clicks -> `EmailStatus.CLICKED`
- hard bounce -> `EmailStatus.BOUNCED` + unsubscribe contact
- soft bounce -> track event, but do not unsubscribe by default
- feedback loop -> `EmailStatus.COMPLAINED` + unsubscribe contact
- failed/rejected if present -> `EmailStatus.FAILED`

Existing bounce/complaint behavior in Plunk is useful and should be reused where possible.

### 24.6 Webhook security correction

ZeptoMail webhooks use a `producer-signature` header and an authentication key configured in ZeptoMail.

Required env vars:

```env
ZEPTOMAIL_WEBHOOK_AUTH_KEY=
ZEPTOMAIL_WEBHOOK_MAX_AGE_SECONDS=300
```

Implementation notes:

- Capture the raw request body for `/webhooks/zeptomail`.
- Validate `producer-signature`.
- Enforce timestamp freshness.
- Use HMAC SHA256 with the ZeptoMail authentication key.
- Reject invalid signatures before processing any event.

This probably requires adding route-specific raw body handling in `apps/api/src/app.ts`, similar to Stripe's raw body handling.

### 24.6.1 Implementation correction: project-scoped ZeptoMail configuration

The implementation should treat ZeptoMail sending and inbound provider webhooks as project-scoped configuration, not only process-wide environment configuration.

Primary project-level fields:

```text
zeptomailSendToken
zeptomailAgentAlias
zeptomailSenderAddress
zeptomailWebhookAuthKey
zeptomailWebhookHeaderKey
zeptomailWebhookHeaderValue
```

Behavioral notes:

- `zeptomailSendToken` is the per-project ZeptoMail authorization token used for sending.
- `zeptomailSenderAddress` is enforced per project. When set, the project can only send from that exact address.
- `zeptomailAgentAlias` is stored for operator/admin mapping to the matching ZeptoMail Mail Agent, but it is not sent to ZeptoMail's `/v1.1/email` API.
- `ZEPTOMAIL_SEND_TOKEN` remains useful only as a legacy/global fallback. Project-scoped tokens are preferred.
- `ZEPTOMAIL_WEBHOOK_AUTH_KEY` remains useful only as a legacy/global fallback for `/webhooks/zeptomail`. Project-scoped webhook auth is preferred.
- `ZEPTOMAIL_DEFAULT_FROM_DOMAIN` is obsolete for this implementation and should not be treated as a required env var.

Webhook auth correction:

ZeptoMail has two relevant webhook-auth paths for this fork:

1. `producer-signature` HMAC validation using the ZeptoMail webhook authentication key.
2. ZeptoMail UI "Authorization headers" validation using a key/value pair configured in ZeptoMail and stored per project as `zeptomailWebhookHeaderKey` and `zeptomailWebhookHeaderValue`.

The app should support both because ZeptoMail's webhook UI exposes authorization headers as key/value fields. The dashboard should surface:

- the webhook URL for the project/Mail Agent,
- the authorization header key to copy into ZeptoMail,
- the authorization header value to copy into ZeptoMail,
- whether sensitive values are already configured without returning those secrets to the browser.

Webhook keys are effectively ZeptoMail Mail-Agent scoped, so they should be project scoped in Plunk when each project maps to its own ZeptoMail Mail Agent.

### 24.7 Env and Docker correction

The app currently hard-requires:

```env
AWS_SES_REGION=
AWS_SES_ACCESS_KEY_ID=
AWS_SES_SECRET_ACCESS_KEY=
```

These must stop being required.

Replace with:

```env
ZEPTOMAIL_SEND_TOKEN=
ZEPTOMAIL_API_URL=https://api.zeptomail.com/v1.1/email
ZEPTOMAIL_WEBHOOK_AUTH_KEY=
ZEPTOMAIL_WEBHOOK_MAX_AGE_SECONDS=300
EMAIL_RATE_LIMIT_PER_SECOND=2
EMAIL_DAILY_LIMIT=5000
EMAIL_WORKER_CONCURRENCY=2
EMAIL_WORKER_MAX_CONCURRENCY=5
DISABLE_SIGNUPS=true
```

Update:

- `apps/api/src/app/constants.ts`
- `.env.self-host.example`
- `docker-compose.yml`
- self-hosting docs if we keep docs in scope

### 24.8 UI correction

The dashboard's domain settings screen is currently SES-specific.

For v1, avoid a large UI rewrite.

Acceptable options:

A. Hide the DNS-record detail panel and show a simple "Verify this domain in ZeptoMail first" message.

B. Keep domain management admin-only and mark domains verified server-side.

C. Remove self-service domain adding from the UI for now and manage domains directly/admin-only.

Recommended MVP:

Use option A or C.

Do not show Amazon SES DNS records in the ZeptoMail fork.

### 24.9 Schema correction

No schema change is required for v1.

The existing `Email.messageId` field is nullable and unique. It can store the ZeptoMail `request_id` or `email_reference`.

The schema comment says AWS SES, but the column shape is provider-neutral enough.

Optional cleanup later:

rename comments/docs from "SES message ID" to "provider message ID".

### 24.10 Tests to prioritize after validation

The minimum tests should cover the actual code paths:

- `SESService.sendRawEmail()` sends ZeptoMail payload shape.
- `sendRawEmail()` includes `client_reference`.
- attachments map to ZeptoMail `attachments`.
- inline images map to ZeptoMail `inline_images`.
- custom headers map to `mime_headers`.
- tracking enabled maps to `track_opens=true` and `track_clicks=true`.
- tracking disabled maps to `track_opens=false` and `track_clicks=false`.
- worker passes `email.id` as `clientReference`.
- campaign test send still works without an email row.
- ZeptoMail webhook rejects invalid signatures.
- ZeptoMail webhook accepts valid signatures.
- delivered/open/click update email status.
- hard bounce unsubscribes contact.
- soft bounce does not unsubscribe contact.
- feedback loop unsubscribes contact.

### 24.11 Revised MVP implementation order

1. Replace required AWS env with ZeptoMail env.
2. Convert `SESService.ts` into a ZeptoMail-backed provider while keeping exported function names.
3. Add `clientReference` to `sendRawEmail()` and pass `email.id` from the email worker.
4. Return env/static quota from `getSendingQuota()`.
5. Make domain verification manual/private by removing SES calls from domain add/check/delete.
6. Disable or simplify scheduled domain verification.
7. Hide/replace SES-specific domain DNS UI.
8. Add `/webhooks/zeptomail` with raw body signature validation.
9. Map ZeptoMail webhook events to existing Plunk email/contact/event behavior.
10. Update Docker/env examples for Coolify.
11. Run focused tests and one real ZeptoMail staging send.
