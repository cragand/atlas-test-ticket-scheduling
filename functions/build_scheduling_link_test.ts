import { SlackFunctionTester } from "deno-slack-sdk/mod.ts";
import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import BuildSchedulingLink, {
  buildSchedulingUrl,
  resolveCalendars,
} from "./build_scheduling_link.ts";

const { createContext } = SlackFunctionTester("build_scheduling_link");

const BASE_INPUTS = {
  test_name: "Stow Regression Suite",
  station: "beta-0304",
  workcells_needed: ["WC1"],
  pod_type: ["H11"],
  duration_hours: 1,
  test_ticket_url: "https://amzn-operations.slack.com/lists/F08QP49B7FV/record",
  test_plan_canvas_url: "https://amzn-operations.slack.com/canvas/F08Q72PJG6Q",
};

Deno.test("resolveCalendars: 0301 uses only its own calendar, ignoring workcells_needed", () => {
  const result = resolveCalendars("beta-0301", ["1:1"]);
  assertEquals(result, { calendars: ["atlas-stow-beta-0301@amazon.com"] });
});

Deno.test("resolveCalendars: 0301 ignores workcells_needed entirely, even if it names a real workcell", () => {
  const result = resolveCalendars("beta-0301", ["WC1"]);
  assertEquals(result, { calendars: ["atlas-stow-beta-0301@amazon.com"] });
});

Deno.test("resolveCalendars: 0304 with no specific workcell uses only the overall calendar", () => {
  const result = resolveCalendars("beta-0304", []);
  assertEquals(result, { calendars: ["atlas-stow-beta-0304@amazon.com"] });
});

Deno.test('resolveCalendars: 0304 with "Any 1 WC" adds no additional calendar', () => {
  const result = resolveCalendars("beta-0304", ["Any 1 WC"]);
  assertEquals(result, { calendars: ["atlas-stow-beta-0304@amazon.com"] });
});

Deno.test("resolveCalendars: 0304 with one specific workcell adds that calendar too", () => {
  const result = resolveCalendars("beta-0304", ["Induct"]);
  assertEquals(result, {
    calendars: [
      "atlas-stow-beta-0304@amazon.com",
      "atlas-stow-beta-0305-induct-transfer@amazon.com",
    ],
  });
});

Deno.test("resolveCalendars: 0304 with multiple specific workcells adds all of them", () => {
  const result = resolveCalendars("beta-0304", ["WC1", "WC2"]);
  assertEquals(result, {
    calendars: [
      "atlas-stow-beta-0304@amazon.com",
      "atlas-stow-beta-0306-WC1@amazon.com",
      "atlas-stow-beta-0307-WC2@amazon.com",
    ],
  });
});

Deno.test("resolveCalendars: matches station case-insensitively (regression pattern from the Emtech app)", () => {
  const result = resolveCalendars("BETA-0304", ["induct"]);
  assertEquals(result, {
    calendars: [
      "atlas-stow-beta-0304@amazon.com",
      "atlas-stow-beta-0305-induct-transfer@amazon.com",
    ],
  });
});

Deno.test("resolveCalendars: returns a clean error for an unrecognized station", () => {
  const result = resolveCalendars("beta-9999", []);
  assertEquals("error" in result, true);
  assertStringIncludes((result as { error: string }).error, "beta-9999");
});

Deno.test("buildSchedulingUrl includes all resolved calendars in participantsByPriority", () => {
  const result = buildSchedulingUrl({
    testName: "Stow Regression Suite",
    station: "beta-0304",
    workcellsNeeded: ["WC1"],
    podType: ["H11"],
    durationHours: 1,
    testTicketUrl: "https://example.com/ticket",
    testPlanCanvasUrl: "https://example.com/canvas",
  });

  assertEquals("error" in result, false);
  const url = (result as { url: string }).url;
  assertStringIncludes(
    url,
    encodeURIComponent(
      "atlas-stow-beta-0304@amazon.com,atlas-stow-beta-0306-WC1@amazon.com",
    ),
  );
});

Deno.test("buildSchedulingUrl converts duration_hours to minutes", () => {
  const result = buildSchedulingUrl({
    testName: "Stow Regression Suite",
    station: "beta-0304",
    workcellsNeeded: [],
    podType: ["H11"],
    durationHours: 2.5,
    testTicketUrl: "https://example.com/ticket",
    testPlanCanvasUrl: "https://example.com/canvas",
  });

  assertEquals("error" in result, false);
  assertStringIncludes((result as { url: string }).url, "durationMinutes=150");
});

Deno.test("buildSchedulingUrl uses a fixed America/Los_Angeles timezone regardless of station", () => {
  const result = buildSchedulingUrl({
    testName: "Stow Regression Suite",
    station: "beta-0301",
    workcellsNeeded: [],
    podType: ["H11"],
    durationHours: 1,
    testTicketUrl: "https://example.com/ticket",
    testPlanCanvasUrl: "https://example.com/canvas",
  });

  assertEquals("error" in result, false);
  assertStringIncludes(
    (result as { url: string }).url,
    encodeURIComponent("America/Los_Angeles"),
  );
});

Deno.test("buildSchedulingUrl embeds the ticket and canvas links in the body", () => {
  const result = buildSchedulingUrl({
    testName: "Stow Regression Suite",
    station: "beta-0304",
    workcellsNeeded: [],
    podType: ["H11"],
    durationHours: 1,
    testTicketUrl: "https://example.com/ticket",
    testPlanCanvasUrl: "https://example.com/canvas",
  });

  assertEquals("error" in result, false);
  const url = (result as { url: string }).url;
  assertStringIncludes(url, encodeURIComponent("https://example.com/ticket"));
  assertStringIncludes(url, encodeURIComponent("https://example.com/canvas"));
});

Deno.test("buildSchedulingUrl surfaces a clean error for an unrecognized station", () => {
  const result = buildSchedulingUrl({
    testName: "Stow Regression Suite",
    station: "beta-9999",
    workcellsNeeded: [],
    podType: ["H11"],
    durationHours: 1,
    testTicketUrl: "https://example.com/ticket",
    testPlanCanvasUrl: "https://example.com/canvas",
  });

  assertEquals("error" in result, true);
});

Deno.test("build_scheduling_link happy path returns a scheduling_url output", async () => {
  const { outputs, error } = await BuildSchedulingLink(
    createContext({ inputs: BASE_INPUTS }),
  );

  assertEquals(error, undefined);
  assertExists(outputs);
  assertStringIncludes(outputs!.scheduling_url, "https://meetings.amazon.com/");
});

Deno.test("build_scheduling_link surfaces a clean error for an unrecognized station", async () => {
  const { outputs, error } = await BuildSchedulingLink(
    createContext({ inputs: { ...BASE_INPUTS, station: "beta-9999" } }),
  );

  assertExists(error);
  assertStringIncludes(error, "beta-9999");
  assertEquals(outputs, undefined);
});
