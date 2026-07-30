import { buildSchedulingUrl, resolveCalendars } from "./build_scheduling_link";

describe("resolveCalendars", () => {
  test("0301 uses only its own calendar, ignoring workcells_needed", () => {
    const result = resolveCalendars("beta-0301", ["1:1"]);
    expect(result).toEqual({ calendars: ["atlas-stow-beta-0301@amazon.com"] });
  });

  test("0301 ignores workcells_needed entirely, even if it names a real workcell", () => {
    const result = resolveCalendars("beta-0301", ["WC1"]);
    expect(result).toEqual({ calendars: ["atlas-stow-beta-0301@amazon.com"] });
  });

  test("0304 with no specific workcell uses only the overall calendar", () => {
    const result = resolveCalendars("beta-0304", []);
    expect(result).toEqual({ calendars: ["atlas-stow-beta-0304@amazon.com"] });
  });

  test('0304 with "Any 1 WC" adds no additional calendar', () => {
    const result = resolveCalendars("beta-0304", ["Any 1 WC"]);
    expect(result).toEqual({ calendars: ["atlas-stow-beta-0304@amazon.com"] });
  });

  test("0304 with one specific workcell adds that calendar too", () => {
    const result = resolveCalendars("beta-0304", ["Induct"]);
    expect(result).toEqual({
      calendars: [
        "atlas-stow-beta-0304@amazon.com",
        "atlas-stow-beta-0305-induct-transfer@amazon.com",
      ],
    });
  });

  test("0304 with multiple specific workcells adds all of them", () => {
    const result = resolveCalendars("beta-0304", ["WC1", "WC2"]);
    expect(result).toEqual({
      calendars: [
        "atlas-stow-beta-0304@amazon.com",
        "atlas-stow-beta-0306-WC1@amazon.com",
        "atlas-stow-beta-0307-WC2@amazon.com",
      ],
    });
  });

  test("matches station case-insensitively", () => {
    const result = resolveCalendars("BETA-0304", ["induct"]);
    expect(result).toEqual({
      calendars: [
        "atlas-stow-beta-0304@amazon.com",
        "atlas-stow-beta-0305-induct-transfer@amazon.com",
      ],
    });
  });

  test("returns a clean error for an unrecognized station", () => {
    const result = resolveCalendars("beta-9999", []);
    expect("error" in result).toBe(true);
    expect((result as { error: string }).error).toContain("beta-9999");
  });
});

describe("buildSchedulingUrl", () => {
  test("includes all resolved calendars in participantsByPriority", () => {
    const result = buildSchedulingUrl({
      testName: "Stow Regression Suite",
      station: "beta-0304",
      workcellsNeeded: ["WC1"],
      podType: ["H11"],
      durationHours: 1,
      testTicketUrl: "https://example.com/ticket",
      testPlanCanvasUrl: "https://example.com/canvas",
    });

    expect("error" in result).toBe(false);
    const url = (result as { url: string }).url;
    expect(url).toContain(
      encodeURIComponent(
        "atlas-stow-beta-0304@amazon.com,atlas-stow-beta-0306-WC1@amazon.com",
      ),
    );
  });

  test("converts duration_hours to minutes", () => {
    const result = buildSchedulingUrl({
      testName: "Stow Regression Suite",
      station: "beta-0304",
      workcellsNeeded: [],
      podType: ["H11"],
      durationHours: 2.5,
      testTicketUrl: "https://example.com/ticket",
      testPlanCanvasUrl: "https://example.com/canvas",
    });

    expect("error" in result).toBe(false);
    expect((result as { url: string }).url).toContain("durationMinutes=150");
  });

  test("uses a fixed America/Los_Angeles timezone regardless of station", () => {
    const result = buildSchedulingUrl({
      testName: "Stow Regression Suite",
      station: "beta-0301",
      workcellsNeeded: [],
      podType: ["H11"],
      durationHours: 1,
      testTicketUrl: "https://example.com/ticket",
      testPlanCanvasUrl: "https://example.com/canvas",
    });

    expect("error" in result).toBe(false);
    expect((result as { url: string }).url).toContain(
      encodeURIComponent("America/Los_Angeles"),
    );
  });

  test("embeds the ticket and canvas links in the body", () => {
    const result = buildSchedulingUrl({
      testName: "Stow Regression Suite",
      station: "beta-0304",
      workcellsNeeded: [],
      podType: ["H11"],
      durationHours: 1,
      testTicketUrl: "https://example.com/ticket",
      testPlanCanvasUrl: "https://example.com/canvas",
    });

    expect("error" in result).toBe(false);
    const url = (result as { url: string }).url;
    expect(url).toContain(encodeURIComponent("https://example.com/ticket"));
    expect(url).toContain(encodeURIComponent("https://example.com/canvas"));
  });

  test("surfaces a clean error for an unrecognized station", () => {
    const result = buildSchedulingUrl({
      testName: "Stow Regression Suite",
      station: "beta-9999",
      workcellsNeeded: [],
      podType: ["H11"],
      durationHours: 1,
      testTicketUrl: "https://example.com/ticket",
      testPlanCanvasUrl: "https://example.com/canvas",
    });

    expect("error" in result).toBe(true);
  });
});
