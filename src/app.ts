import { App } from "@slack/bolt";
import { buildSchedulingUrl } from "./build_scheduling_link";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

// Synchronous completion - unlike the official tutorial's example (which
// waits for a button click before calling complete()), this function is
// pure computation with no user interaction needed, so it completes (or
// fails) immediately within the same handler.
app.function(
  "build_scheduling_link",
  async ({ inputs, complete, fail }) => {
    try {
      const result = buildSchedulingUrl({
        testName: inputs.test_name as string,
        station: inputs.station as string,
        workcellsNeeded: inputs.workcells_needed as string[],
        podType: inputs.pod_type as string[],
        durationHours: inputs.duration_hours as number,
        testTicketUrl: inputs.test_ticket_url as string,
        testPlanCanvasUrl: inputs.test_plan_canvas_url as string,
      });

      if ("error" in result) {
        await fail({ error: result.error });
        return;
      }

      await complete({ outputs: { scheduling_url: result.url } });
    } catch (error) {
      console.error(error);
      await fail({ error: `Failed to build the scheduling link: ${error}` });
    }
  },
);

(async () => {
  await app.start();
  console.log("Atlas Test Ticket Scheduling (Bolt) app started");
})();
