# Atlas Test Ticket Scheduling

A Bolt for JavaScript custom step for the existing "Atlas Test Ticket
Submission" Workflow Builder workflow at Amazon. It replaces that workflow's
native, hardcoded two-station scheduling-link construction with support for
all 5 real workcell/induct calendars.

## Why Bolt, not the Deno SDK (next-gen platform)

This project originally used Slack's Deno SDK / next-gen platform (the same
architecture as Emtech's own `create_calendar_event` app) — Slack-hosted, no
infrastructure to manage. That version is preserved on the
[`deno-sdk-archived`](../../tree/deno-sdk-archived) branch for reference.

It had to be abandoned: Amazon's Slack grid **blocks next-gen apps
outright**, confirmed directly by an app-approval denial —
`Next-gen apps are currently blocked on the Amazon grid.` No scope or
manifest change could have worked around this; it's a platform-level
restriction, not a configuration issue.

Amazon's supported path is classic Slack apps (Bolt), self-hosted via
**Socket Mode** rather than Slack-hosted infrastructure — which is also
exactly what was originally suggested before the Deno SDK path was tried, and
turned out to be the only route that actually works here.

## What ported over unchanged

The actual business logic — the station/workcell calendar lookup table, the
branching rules (0301 standalone vs. 0304 + its 4 workcell calendars), the
scheduling URL construction — has zero Deno-specific dependencies, so it
ported over as plain TypeScript with no changes. See
`src/build_scheduling_link.ts` and its test file for the full logic and
test coverage (13 tests).

Only the Slack-integration layer changed: `DefineFunction`/`SlackFunction`
(Deno SDK) became `manifest.json` + `app.function()` (Bolt).

## Calendar lookup

| Station/workcell | Calendar |
| --- | --- |
| 0301 (standalone system) | `atlas-stow-beta-0301@amazon.com` |
| 0304 (overall system) | `atlas-stow-beta-0304@amazon.com` |
| Induct | `atlas-stow-beta-0305-induct-transfer@amazon.com` |
| WC1 | `atlas-stow-beta-0306-WC1@amazon.com` |
| WC2 | `atlas-stow-beta-0307-WC2@amazon.com` |
| WC3 | `atlas-stow-beta-0308-WC3@amazon.com` |

- **0301**: uses only its own calendar — the "Which workcells do you need?"
  form field is irrelevant for this station (0301 has no individual
  workcells).
- **0304**: always includes the 0304 overall calendar, **plus** the specific
  calendar for any of Induct/WC1/WC2/WC3 named in "Which workcells do you
  need?" (multiple can be selected at once). `Any 1 WC` and `1:1` add nothing
  extra — `Any 1 WC` means operators self-coordinate and add their own
  workcell calendar manually.

## Known open item

The multiple-calendar delimiter in `participantsByPriority` is a comma —
the most common web convention, but **not yet confirmed against the real
`meetings.amazon.com` tool**. Needs a live test with 2+ calendars before
fully trusting it.

## Running locally

```sh
npm install
cp .env.example .env   # fill in real SLACK_BOT_TOKEN / SLACK_APP_TOKEN
npm run dev
```

## Testing

```sh
npm test
```

## Building for deployment

```sh
npm run build   # compiles to dist/
npm start        # runs the compiled output
```

## Deployment (self-hosted, Socket Mode)

Runs as a persistent process — not Slack-hosted. See project notes for the
AWS hosting plan (ECS/Fargate recommended over EC2 or Lambda — Socket Mode
needs a long-lived connection, which Lambda's execution model doesn't fit;
Fargate avoids the OS-patching overhead EC2 would add). Secrets
(`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`) belong in AWS Secrets Manager or SSM
Parameter Store, never hardcoded or committed.

## App approval at Amazon

Went through Amazon's OPUS Apps Approval Process (OPAA). One real finding
from that process: the `commands` scope (rated "2 - Medium" in Amazon's
internal risk table) was denied at the org-level install step, despite
documented policy suggesting only High-risk scopes require review in
practice. Switched to `app_mentions:read` (rated "1 - Low") instead, since
this function doesn't functionally use the Slack API at all — any scope
choice is just satisfying Slack's "a bot user needs at least one scope"
requirement, so the lowest-risk one available is the right pick.
