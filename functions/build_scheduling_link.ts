import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";

/**
 * Builds the meetings.amazon.com scheduling link used in the Atlas Test
 * Ticket Submission workflow's Canvas (the "Outlook Scheduling Link"),
 * replacing the native string-building step that only supported two
 * hardcoded stations. Pure computation — no external network calls, no
 * Slack API calls beyond receiving inputs and returning outputs.
 */
export const BuildSchedulingLinkDefinition = DefineFunction({
  callback_id: "build_scheduling_link",
  title: "Build Atlas scheduling link",
  description:
    "Builds the workcell scheduling meeting link for an Atlas test ticket",
  source_file: "functions/build_scheduling_link.ts",
  input_parameters: {
    properties: {
      test_name: {
        type: Schema.types.string,
        description: "Test Name from the ticket form",
      },
      station: {
        type: Schema.types.string,
        description:
          '"Station test will be on" form answer (e.g. "beta-0301", "beta-0304")',
      },
      workcells_needed: {
        type: Schema.types.array,
        items: { type: Schema.types.string },
        description:
          '"Which workcells do you need?" form answers (e.g. ["Induct", "WC1"]) — only meaningful when station is the 0304 system; ignored for 0301',
      },
      pod_type: {
        type: Schema.types.array,
        items: { type: Schema.types.string },
        description: "Pod Type form answers, used in the meeting subject",
      },
      duration_hours: {
        type: Schema.types.number,
        description:
          "Duration (hours) form answer, converted to the meeting's suggested duration in minutes",
      },
      test_ticket_url: {
        type: Schema.types.string,
        description:
          'URL of the Test Ticket List record (output of the earlier "add a record" step)',
      },
      test_plan_canvas_url: {
        type: Schema.types.string,
        description:
          "URL of the Test Plan Canvas (output of the earlier Canvas-creation step)",
      },
    },
    required: [
      "test_name",
      "station",
      "workcells_needed",
      "pod_type",
      "duration_hours",
      "test_ticket_url",
      "test_plan_canvas_url",
    ],
  },
  output_parameters: {
    properties: {
      scheduling_url: {
        type: Schema.types.string,
        description: "The constructed meetings.amazon.com scheduling link",
      },
    },
    required: ["scheduling_url"],
  },
});

// The 0301 system is standalone — no individual workcells, so
// workcells_needed is irrelevant whenever this station is selected. Kept in
// the same lookup-table shape as the 0304 system (a single calendar, no
// workcell breakdown) specifically so a future workcell breakdown for 0301
// can be added the same way 0304's was, without restructuring this table.
const STATION_CALENDARS: Record<string, string> = {
  "beta-0301": "atlas-stow-beta-0301@amazon.com",
  "beta-0304": "atlas-stow-beta-0304@amazon.com",
};

// Only the 0304 system currently has individual workcell breakdowns. "Any 1
// WC" and "1:1" are deliberately absent — "Any 1 WC" means operators
// self-coordinate and add their own workcell calendar manually (no specific
// calendar to invite automatically), and "1:1" is just the natural
// workcells_needed value when station is 0301 (not a real workcell
// selection), so neither should resolve to an additional calendar.
const WORKCELL_CALENDARS: Record<string, string> = {
  "Induct": "atlas-stow-beta-0305@amazon.com",
  "WC1": "atlas-stow-beta-0306@amazon.com",
  "WC2": "atlas-stow-beta-0307@amazon.com",
  "WC3": "atlas-stow-beta-0308@amazon.com",
};

// Matches case-insensitively (and trims whitespace), same reasoning as the
// Emtech app's getCategoryForRequestType() — a dropdown's exact wording/case
// shouldn't cause a legitimate value to be rejected as unrecognized.
function lookupCaseInsensitive(
  table: Record<string, string>,
  value: string,
): string | undefined {
  const normalized = value.trim().toLowerCase();
  for (const [key, resolved] of Object.entries(table)) {
    if (key.toLowerCase() === normalized) {
      return resolved;
    }
  }
  return undefined;
}

// Resolves which calendar(s) to invite to the scheduling meeting.
//
// - 0301: that station's calendar alone, regardless of workcells_needed.
// - 0304: that station's calendar, plus each workcell in workcells_needed
//   that maps to a specific calendar (Induct/WC1/WC2/WC3) — so the meeting
//   always lands on the overall 0304 calendar for tracking, and also on the
//   specific workcell's calendar(s) when one or more were named.
export function resolveCalendars(
  station: string,
  workcellsNeeded: string[],
): { calendars: string[] } | { error: string } {
  const stationCalendar = lookupCaseInsensitive(STATION_CALENDARS, station);
  if (!stationCalendar) {
    return { error: `No calendar mapping configured for station "${station}"` };
  }

  const is0304 = lookupCaseInsensitive(
    { "beta-0304": "beta-0304" },
    station,
  ) !== undefined;
  if (!is0304) {
    return { calendars: [stationCalendar] };
  }

  const calendars = [stationCalendar];
  for (const workcell of workcellsNeeded) {
    const workcellCalendar = lookupCaseInsensitive(
      WORKCELL_CALENDARS,
      workcell,
    );
    if (workcellCalendar && !calendars.includes(workcellCalendar)) {
      calendars.push(workcellCalendar);
    }
  }
  return { calendars };
}

// NOTE: the exact delimiter meetings.amazon.com expects for multiple
// participantsByPriority values hasn't been confirmed against the real tool
// yet — this uses a comma, the most common web convention, but this needs a
// live test (a real multi-calendar scheduling link) before trusting it.
function buildParticipantsParam(calendars: string[]): string {
  return calendars.join(",");
}

const STATIC_BODY_INTRO =
  "<div>This test is to reserve time on the <strong>Atlas </strong>workcell</div>";
const STATIC_BODY_OUTRO = "<div><br></div>" +
  "<div>For details on the Atlas testing process reference " +
  '<a rel="noopener noreferrer" href="https://tiny.amazon.com/gbbh89m/tests">Vulcan Stow Atlas Testing Process</a></div>' +
  "<div><br></div>" +
  "<div>To connect to the workcell Operator, comment on you Test Ticket or if you want to contact more broad Test Support use the Slack User Group @atlas-test-support</div>" +
  "<div><br></div>" +
  "<div>---------------------------------------------------------------------------------------------------------------------------------------------------------------------</div>";

export function buildSchedulingUrl(inputs: {
  testName: string;
  station: string;
  workcellsNeeded: string[];
  podType: string[];
  durationHours: number;
  testTicketUrl: string;
  testPlanCanvasUrl: string;
}): { url: string } | { error: string } {
  const resolved = resolveCalendars(inputs.station, inputs.workcellsNeeded);
  if ("error" in resolved) {
    return resolved;
  }

  const subject = `[${inputs.workcellsNeeded.join(", ")}] *${
    inputs.podType.join(", ")
  }* ${inputs.testName}`;

  const body = STATIC_BODY_INTRO +
    `<div><a rel="noopener noreferrer" href="${inputs.testTicketUrl}">Test Ticket Link</a></div>` +
    `<div><a rel="noopener noreferrer" href="${inputs.testPlanCanvasUrl}">Test Plan Link</a></div>` +
    STATIC_BODY_OUTRO;

  const durationMinutes = Math.round(inputs.durationHours * 60);

  const params = new URLSearchParams({
    participantsByPriority: buildParticipantsParam(resolved.calendars),
    durationMinutes: String(durationMinutes),
    startTime: "09:00:00",
    endTime: "17:30:00",
    suggestionViewType: "grid",
    filterWeekDays: "Monday,Tuesday,Wednesday,Thursday,Friday",
    timezone: "America/Los_Angeles",
    subject,
    body,
    permalinkButton: "true",
  });

  return {
    url: `https://meetings.amazon.com/#/create-meeting?&${params.toString()}`,
  };
}

export default SlackFunction(
  BuildSchedulingLinkDefinition,
  ({ inputs }) => {
    const result = buildSchedulingUrl({
      testName: inputs.test_name,
      station: inputs.station,
      workcellsNeeded: inputs.workcells_needed,
      podType: inputs.pod_type,
      durationHours: inputs.duration_hours,
      testTicketUrl: inputs.test_ticket_url,
      testPlanCanvasUrl: inputs.test_plan_canvas_url,
    });

    if ("error" in result) {
      return { error: result.error };
    }

    return { outputs: { scheduling_url: result.url } };
  },
);
