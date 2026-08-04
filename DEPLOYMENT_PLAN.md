# Deployment Plan

Step-by-step execution plan for deploying `build_scheduling_link` — from image
build through production cutover and wiring into the real workflow. See
`README.md` for the architecture/rationale behind each AWS and Slack choice;
this doc is the checklist for actually doing it.

## Phase 0 — Confirm access before starting

Check these with the team first — no point starting Phase 1 only to stall on
Phase 2:

| Needed | For |
| --- | --- |
| AWS account/role with permission to create: ECR repo, Secrets Manager secrets, IAM roles, ECS task definitions/services, security groups | Phases 2–3 |
| A build environment that isn't Docker Desktop (AWS CloudShell, WSL2 w/ Docker Engine, or CodeBuild access) | Phase 1 |
| Ability to provision a personal Slack sandbox (`/provision` in Slack) | Phase 4 |
| Collaborator access to add `opus-amazon-prod` on a Slack app | Phase 5 |
| Whoever owns the real "Atlas Test Ticket Submission" workflow — need them (or their permission) to duplicate it for a test wiring | Phase 7 |

## Phase 1 — Build and push the image

Skip Docker Desktop (blocked by org policy). Use AWS CloudShell or WSL2 Docker
Engine.

```sh
# from repo root, in CloudShell or WSL2
docker build -t atlas-test-ticket-scheduling .
```

**Permission checkpoint:** pushing to ECR requires `ecr:CreateRepository`,
`ecr:GetAuthorizationToken`, `ecr:PutImage` (or an equivalent role attached in
CloudShell).

```sh
aws ecr create-repository --repository-name atlas-test-ticket-scheduling --region <REGION>

aws ecr get-login-password --region <REGION> \
  | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com

docker tag atlas-test-ticket-scheduling:latest \
  <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/atlas-test-ticket-scheduling:latest

docker push <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/atlas-test-ticket-scheduling:latest
```

## Phase 2 — AWS infrastructure (one-time setup)

**Permission checkpoint:** needs IAM role-creation rights (for the task
execution role), Secrets Manager write access, and ECS/VPC console or CLI
access. Most likely phase to need a team member with broader AWS permissions.

1. **Secrets Manager** — store the two tokens (placeholders until sandbox
   tokens exist in Phase 4):
   ```sh
   aws secretsmanager create-secret --name atlas-scheduling/SLACK_BOT_TOKEN --secret-string "placeholder"
   aws secretsmanager create-secret --name atlas-scheduling/SLACK_APP_TOKEN --secret-string "placeholder"
   ```
2. **Task execution role** — `AmazonECSTaskExecutionRolePolicy` plus
   permission to read the two secrets above. Let the console's "Create new
   role" flow generate this when defining the task, rather than hand-rolling
   the policy.
3. **Task role** (runtime permissions) — leave empty/default. This app only
   talks to Slack.
4. **Networking** — a public subnet, security group with **no inbound
   rules**, default outbound only. If the VPC doesn't already have a suitable
   public subnet, ask the team before creating one.
5. **Task Definition** — Fargate, 0.25 vCPU / 0.5 GB, points at the ECR image,
   wires in both secrets by ARN, `awslogs` driver → a CloudWatch Log Group
   (create the log group first, or let the console do it).
6. **ECS Service** — from that task definition, desired count 1, **no load
   balancer**. Without one, ECS restarts the task if the process dies, using
   process-liveness as the health check — the right fit for a Socket Mode app
   with no inbound port to health-check.

At the end of this phase, nothing is running against real Slack yet — the
secrets are still placeholders.

## Phase 3 — Slack sandbox

**Permission checkpoint:** none beyond your own Slack account — sandbox
creation is self-service and self-approved.

1. In Slack: `/provision` → "Provision Sandbox with Opus."
2. Inside the sandbox, create a new Slack app from `manifest.json` in this
   repo (Slack App Config → "Create New App" → "From an app manifest").
3. Grab the sandbox app's **Bot Token** and **App-Level Token**.
4. Update the two secrets in Secrets Manager with these real sandbox values:
   ```sh
   aws secretsmanager put-secret-value --secret-id atlas-scheduling/SLACK_BOT_TOKEN --secret-string "xoxb-..."
   aws secretsmanager put-secret-value --secret-id atlas-scheduling/SLACK_APP_TOKEN --secret-string "xapp-..."
   ```
5. Force a new ECS deployment so the running task picks up the new secret
   values:
   ```sh
   aws ecs update-service --cluster <CLUSTER> --service <SERVICE> --force-new-deployment
   ```
6. Check CloudWatch logs for `Atlas Test Ticket Scheduling (Bolt) app
   started`.

## Phase 4 — Test in the sandbox

This is also where the one open question in the code gets resolved: whether a
comma is the correct delimiter for multiple calendars in
`participantsByPriority`.

1. In the sandbox workspace, build (or reuse) a Workflow Builder workflow
   that calls `build_scheduling_link` with a station like `0304` and 2+
   workcells selected.
2. Run it, inspect the generated `scheduling_url` output.
3. Paste that URL into the real `meetings.amazon.com` tool (or open it) and
   confirm it correctly resolves to multiple calendars, not just one or an
   error.
4. If the delimiter is wrong, fix `build_scheduling_link.ts`, re-run
   `npm test`, rebuild, repush the image, redeploy (Phase 1 + the
   `force-new-deployment` command above).

Don't move to Phase 5 until this is confirmed — it's the one part of the
logic that hasn't been validated against the real tool.

## Phase 5 — Promote to the production Amazon grid

**Permission checkpoint:** this is Amazon's internal app-approval process
(OPAA) — timing depends on their review queue, not you.

1. In the sandbox app's config, export the manifest as YAML.
2. In the production Amazon grid, Slack App Config → "Create New App" →
   "From an app manifest" → paste the YAML.
3. Add `opus-amazon-prod` as a collaborator on the new production app.
4. Click "Request Install."
5. Follow the "Continue Installation" DM from the OPUS Apps Approval Process
   bot, filling out whatever forms it asks for.
6. Wait for approval. (`commands` scope was previously denied as Medium-risk
   despite policy suggesting only High-risk needs review — this app already
   avoids that by using `app_mentions:read`, so it shouldn't hit the same
   wall, but budget time for review regardless.)

## Phase 6 — Cutover to production tokens

1. Once approved, get the production app's real Bot Token + App-Level Token.
2. Update the same two Secrets Manager entries with the production values
   (same commands as Phase 3, step 4).
3. `aws ecs update-service ... --force-new-deployment` again.
4. Confirm in CloudWatch logs that it started and, ideally, run one real test
   through the production workflow before calling it done.

## Phase 7 — Wire into the real workflow

**Permission checkpoint:** likely need the workflow owner's help or sign-off
here.

1. Duplicate the live "Atlas Test Ticket Submission" workflow (don't edit the
   original directly).
2. In the duplicate, swap the old hardcoded two-station scheduling-link step
   for the new `build_scheduling_link` custom step.
3. Test end-to-end on the duplicate.
4. Once confirmed, apply the same swap to the real, live workflow.
