import { Manifest } from "deno-slack-sdk/mod.ts";
import { BuildSchedulingLinkDefinition } from "./functions/build_scheduling_link.ts";

/**
 * The app manifest contains the app's configuration. This
 * file defines attributes like app name and description.
 * https://api.slack.com/automation/manifest
 */
export default Manifest({
  name: "Atlas Test Ticket Scheduling",
  description:
    "Custom step for the Atlas Test Ticket Submission workflow that builds the workcell scheduling meeting link",
  icon: "assets/default_new_app_icon.png",
  functions: [BuildSchedulingLinkDefinition],
  outgoingDomains: [],
  // Slack requires at least one bot scope whenever a bot user exists (every
  // Deno SDK app has one automatically) - this function never calls the
  // Slack API at all, so this exists purely to satisfy that requirement.
  // Deliberately the lowest-risk scope available (Amazon's internal risk
  // tiering rates this "1 - Low") - "commands" (rated "2 - Medium") was
  // denied at the org-level install approval step.
  botScopes: ["app_mentions:read"],
});
