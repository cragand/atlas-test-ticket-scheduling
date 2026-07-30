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

Locally (no container):

```sh
npm run build   # compiles to dist/
npm start        # runs the compiled output
```

As a container (the `Dockerfile` in this repo, multi-stage — compiles
TypeScript in a build stage, then copies only the compiled output and
production dependencies into the runtime image):

```sh
docker build -t atlas-test-ticket-scheduling .
docker run --env-file .env atlas-test-ticket-scheduling
```

Note: Docker Desktop on a Windows machine may require an organization
sign-in/license depending on company policy (hit this directly at Amazon —
Docker Desktop enforced `amazonians` org membership, denied without a paid
license). This only affects Docker Desktop specifically, not Docker/Docker
Engine in general — building and pushing the image can be done instead via
AWS CloudShell (Docker pre-installed, nothing to set up locally), WSL2 with
Docker Engine installed directly (not Docker Desktop), or AWS CodeBuild, all
of which avoid the Docker Desktop licensing requirement entirely.

## Deployment — self-hosted (Socket Mode), not Slack-hosted

Runs as a persistent process on infrastructure we control, since Socket Mode
requires an app that holds an open, long-lived connection to Slack — the
opposite of what Slack-hosted next-gen apps provided, and unavailable to us
anyway since next-gen apps are blocked on Amazon's grid.

### AWS side

- **Compute: ECS on Fargate**, not EC2 or Lambda. Lambda's short-lived,
  on-demand execution model doesn't fit a process that needs to hold a
  persistent connection. Fargate avoids EC2's OS-patching overhead.
- **ECR**: a private repository holding the built image (`docker tag` +
  `docker push` after building from the `Dockerfile` above).
- **Secrets Manager** (or SSM Parameter Store): stores `SLACK_BOT_TOKEN` and
  `SLACK_APP_TOKEN` — referenced by ARN from the task definition, never
  baked into the image or committed anywhere.
- **Task Definition**: Fargate launch type, smallest task size (0.25 vCPU /
  0.5 GB is almost certainly enough), points at the ECR image, wires in the
  two secrets, and enables `awslogs` logging to a CloudWatch Log Group.
- **Task execution role**: needs permission to pull from ECR, read the two
  secrets, and write to the log group — the console's default flow usually
  generates this correctly. The task role itself (permissions the app needs
  at runtime) can stay empty, since this app only talks to Slack, not any
  other AWS service.
- **Networking**: a public subnet with a security group that has **no
  inbound rules** and default outbound only. Since Socket Mode never
  receives inbound traffic, there's no need for a Load Balancer, a public
  IP, or any inbound rule — genuinely simpler than a typical web service.
- **ECS Service**: created from the task definition, desired count 1,
  **no load balancer attached** — without one, ECS tracks health by whether
  the container process is still running (not an HTTP health check), and
  restarts it automatically if it crashes. This is the detail that makes a
  plain ECS service the right fit here, rather than something like AWS App
  Runner, which expects the container to listen on a port and actively
  health-checks it — a poor match for a pure outbound-only Socket Mode app.
- **Updating**: rebuild the image, push a new version to the same ECR repo,
  then force a new deployment on the ECS service.

### Slack side — sandbox first, then promote to production

The Slack app registration/approval process and the AWS hosting are mostly
independent — they only connect at one point: whichever Bot Token +
App-Level Token the running container is given determines which Slack app
it's acting as. The same image can run against sandbox tokens for testing
and production tokens later, unchanged.

1. Provision a personal developer sandbox (`/provision` in Slack →
   "Provision Sandbox with Opus") — self-approved, since you're the admin
   of your own sandbox.
2. Create the Slack app in the sandbox, matching `manifest.json`, and get
   its tokens.
3. Test everything there first — this is also where the one open question
   in the code (see below) gets confirmed, risk-free.
4. Export the sandbox app's manifest as YAML, then import it into the
   production Amazon grid (targeting the real workspace) via Slack App
   Config → "Create New App" → "From an app manifest."
5. Add `opus-amazon-prod` as a collaborator on the new production app —
   required for Amazon's tooling to evaluate its scopes/endpoints.
6. Click "Request Install," follow the "Continue Installation" DM from the
   OPUS Apps Approval Process bot, and fill out the requested forms.
7. Once approved, get the production app's real tokens and point the
   running container at those instead of the sandbox ones.
8. Wire the deployed function into the real "Atlas Test Ticket Submission"
   workflow — ideally on a duplicate/test copy first, not the live one.

### App approval findings at Amazon (OPUS Apps Approval Process / OPAA)

- The `commands` scope (rated "2 - Medium" in Amazon's internal risk table)
  was denied at the org-level install step, despite documented policy
  suggesting only High-risk scopes require review in practice. Switched to
  `app_mentions:read` (rated "1 - Low") instead, since this function
  doesn't functionally use the Slack API at all — any scope choice is just
  satisfying Slack's "a bot user needs at least one scope" requirement, so
  the lowest-risk one available is the right pick.
