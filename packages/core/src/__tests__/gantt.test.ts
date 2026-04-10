import { describe, it, expect } from "vitest";
import {
  parseMermaidGantt,
  ganttDataToMermaid,
  generateTaskId,
  createDefaultGanttData,
  type GanttData,
} from "../gantt";

// --- parseMermaidGantt ---

describe("parseMermaidGantt", () => {
  it("parses a basic gantt chart with title, dateFormat, sections, and tasks", () => {
    const input = `gantt
    title My Project
    dateFormat YYYY-MM-DD
    section Planning
    Research :t1, 2026-04-01, 3d
    Design   :t2, after t1, 5d`;

    const result = parseMermaidGantt(input);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("My Project");
    expect(result!.dateFormat).toBe("YYYY-MM-DD");
    expect(result!.sections).toHaveLength(1);
    expect(result!.sections[0].title).toBe("Planning");
    expect(result!.sections[0].tasks).toHaveLength(2);
  });

  it("returns null for non-gantt input", () => {
    expect(parseMermaidGantt("graph TD\n  A --> B")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseMermaidGantt("")).toBeNull();
  });

  it("handles tasks with status flags: done, active, crit, milestone", () => {
    const input = `gantt
    dateFormat YYYY-MM-DD
    section Work
    Completed :done, t1, 2026-04-01, 3d
    Current   :active, t2, after t1, 5d
    Important :crit, t3, 2026-04-10, 2d
    Release   :milestone, t4, 2026-04-15, 0d`;

    const result = parseMermaidGantt(input)!;
    expect(result.sections[0].tasks[0].status).toBe("done");
    expect(result.sections[0].tasks[1].status).toBe("active");
    expect(result.sections[0].tasks[2].status).toBe("crit");
    expect(result.sections[0].tasks[3].status).toBe("milestone");
  });

  it("handles task dependencies (after taskId)", () => {
    const input = `gantt
    dateFormat YYYY-MM-DD
    section Deps
    First  :t1, 2026-04-01, 3d
    Second :t2, after t1, 5d`;

    const result = parseMermaidGantt(input)!;
    expect(result.sections[0].tasks[1].afterDeps).toEqual(["t1"]);
  });

  it("handles tasks with explicit start dates", () => {
    const input = `gantt
    dateFormat YYYY-MM-DD
    section Schedule
    Task A :t1, 2026-04-01, 3d`;

    const result = parseMermaidGantt(input)!;
    expect(result.sections[0].tasks[0].startDate).toBe("2026-04-01");
  });

  it("handles excludes weekends", () => {
    const input = `gantt
    dateFormat YYYY-MM-DD
    excludes weekends
    section Work
    Task :t1, 2026-04-01, 5d`;

    const result = parseMermaidGantt(input)!;
    expect(result.excludes).toBe("weekends");
  });

  it("handles multiple sections with multiple tasks each", () => {
    const input = `gantt
    title Multi
    dateFormat YYYY-MM-DD
    section Phase 1
    Task A :t1, 2026-04-01, 3d
    Task B :t2, after t1, 2d
    section Phase 2
    Task C :t3, after t2, 4d
    Task D :t4, after t3, 1d`;

    const result = parseMermaidGantt(input)!;
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].tasks).toHaveLength(2);
    expect(result.sections[1].tasks).toHaveLength(2);
    expect(result.sections[1].title).toBe("Phase 2");
  });

  it("handles tasks with no ID (auto-generated)", () => {
    const input = `gantt
    dateFormat YYYY-MM-DD
    section Work
    My Task :2026-04-01, 3d`;

    const result = parseMermaidGantt(input)!;
    const task = result.sections[0].tasks[0];
    expect(task.title).toBe("My Task");
    expect(task.id).toBeTruthy(); // auto-generated
  });

  it("creates a default section for tasks without a section header", () => {
    const input = `gantt
    dateFormat YYYY-MM-DD
    Task A :t1, 2026-04-01, 3d`;

    const result = parseMermaidGantt(input)!;
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].title).toBe("Tasks");
  });

  it("handles axisFormat directive", () => {
    const input = `gantt
    dateFormat YYYY-MM-DD
    axisFormat %m/%d
    section Work
    Task :t1, 2026-04-01, 3d`;

    const result = parseMermaidGantt(input)!;
    expect(result.axisFormat).toBe("%m/%d");
  });
});

// --- ganttDataToMermaid ---

describe("ganttDataToMermaid", () => {
  it("serializes a basic GanttData back to valid mermaid syntax", () => {
    const data: GanttData = {
      title: "Test",
      dateFormat: "YYYY-MM-DD",
      sections: [
        {
          title: "Section 1",
          tasks: [
            {
              id: "t1",
              title: "Task A",
              startDate: "2026-04-01",
              duration: "3d",
            },
          ],
        },
      ],
    };
    const output = ganttDataToMermaid(data);
    expect(output).toContain("gantt");
    expect(output).toContain("title Test");
    expect(output).toContain("section Section 1");
    expect(output).toContain("Task A :t1, 2026-04-01, 3d");
  });

  it("output starts with gantt", () => {
    const data: GanttData = {
      title: "",
      dateFormat: "YYYY-MM-DD",
      sections: [
        { title: "S", tasks: [{ id: "t1", title: "T", duration: "1d" }] },
      ],
    };
    expect(ganttDataToMermaid(data).startsWith("gantt")).toBe(true);
  });

  it("includes title, dateFormat, excludes when present", () => {
    const data: GanttData = {
      title: "My Chart",
      dateFormat: "YYYY-MM-DD",
      excludes: "weekends",
      sections: [
        { title: "S", tasks: [{ id: "t1", title: "T", duration: "1d" }] },
      ],
    };
    const output = ganttDataToMermaid(data);
    expect(output).toContain("title My Chart");
    expect(output).toContain("dateFormat YYYY-MM-DD");
    expect(output).toContain("excludes weekends");
  });

  it("includes axisFormat when present", () => {
    const data: GanttData = {
      title: "",
      dateFormat: "YYYY-MM-DD",
      axisFormat: "%m/%d",
      sections: [
        { title: "S", tasks: [{ id: "t1", title: "T", duration: "1d" }] },
      ],
    };
    expect(ganttDataToMermaid(data)).toContain("axisFormat %m/%d");
  });

  it("status flags appear in output", () => {
    const data: GanttData = {
      title: "",
      dateFormat: "YYYY-MM-DD",
      sections: [
        {
          title: "S",
          tasks: [
            {
              id: "t1",
              title: "Done Task",
              status: "done",
              startDate: "2026-04-01",
              duration: "3d",
            },
            {
              id: "t2",
              title: "Active Task",
              status: "active",
              startDate: "2026-04-04",
              duration: "2d",
            },
            {
              id: "t3",
              title: "Critical Task",
              status: "crit",
              startDate: "2026-04-06",
              duration: "1d",
            },
          ],
        },
      ],
    };
    const output = ganttDataToMermaid(data);
    expect(output).toContain("done");
    expect(output).toContain("active");
    expect(output).toContain("crit");
  });

  it("serializes dependencies with after keyword", () => {
    const data: GanttData = {
      title: "",
      dateFormat: "YYYY-MM-DD",
      sections: [
        {
          title: "S",
          tasks: [
            {
              id: "t1",
              title: "First",
              startDate: "2026-04-01",
              duration: "3d",
            },
            { id: "t2", title: "Second", afterDeps: ["t1"], duration: "5d" },
          ],
        },
      ],
    };
    const output = ganttDataToMermaid(data);
    expect(output).toContain("after t1");
  });
});

// --- Roundtrip ---

describe("Roundtrip: parse → serialize → parse", () => {
  it("parse a gantt string, serialize it, parse again — result matches original parse", () => {
    const input = `gantt
    title Roundtrip
    dateFormat YYYY-MM-DD
    section Build
    Compile :t1, 2026-04-01, 3d
    Test    :t2, after t1, 2d`;

    const first = parseMermaidGantt(input)!;
    const serialized = ganttDataToMermaid(first);
    const second = parseMermaidGantt(serialized)!;

    expect(second.title).toBe(first.title);
    expect(second.dateFormat).toBe(first.dateFormat);
    expect(second.sections).toHaveLength(first.sections.length);
    expect(second.sections[0].tasks).toHaveLength(
      first.sections[0].tasks.length,
    );
    expect(second.sections[0].tasks[0].title).toBe(
      first.sections[0].tasks[0].title,
    );
    expect(second.sections[0].tasks[1].afterDeps).toEqual(
      first.sections[0].tasks[1].afterDeps,
    );
  });

  it("works with a complex chart (multiple sections, dependencies, milestones)", () => {
    const input = `gantt
    title Complex Project
    dateFormat YYYY-MM-DD
    excludes weekends
    section Design
    Wireframes :done, t1, 2026-04-01, 5d
    Mockups    :active, t2, after t1, 3d
    section Development
    Backend  :crit, t3, after t2, 10d
    Frontend :t4, after t2, 8d
    section Launch
    Release  :milestone, t5, after t3 t4, 0d`;

    const first = parseMermaidGantt(input)!;
    const serialized = ganttDataToMermaid(first);
    const second = parseMermaidGantt(serialized)!;

    expect(second.title).toBe("Complex Project");
    expect(second.excludes).toBe("weekends");
    expect(second.sections).toHaveLength(3);
    expect(second.sections[0].tasks[0].status).toBe("done");
    expect(second.sections[1].tasks[0].status).toBe("crit");
  });
});

// --- generateTaskId ---

describe("generateTaskId", () => {
  it("returns t1 for empty set", () => {
    expect(generateTaskId(new Set())).toBe("t1");
  });

  it("skips IDs that already exist in the set", () => {
    expect(generateTaskId(new Set(["t1"]))).toBe("t2");
    expect(generateTaskId(new Set(["t1", "t2", "t3"]))).toBe("t4");
  });

  it("returns a string matching tN pattern", () => {
    const id = generateTaskId(new Set());
    expect(id).toMatch(/^t\d+$/);
  });
});

// --- createDefaultGanttData ---

describe("createDefaultGanttData", () => {
  it("returns an object with title, dateFormat, at least one section with tasks", () => {
    const data = createDefaultGanttData();
    expect(data.title).toBeTruthy();
    expect(data.dateFormat).toBeTruthy();
    expect(data.sections.length).toBeGreaterThanOrEqual(1);
    expect(data.sections[0].tasks.length).toBeGreaterThanOrEqual(1);
  });

  it("all tasks have IDs", () => {
    const data = createDefaultGanttData();
    for (const section of data.sections) {
      for (const task of section.tasks) {
        expect(task.id).toBeTruthy();
      }
    }
  });

  it("start dates are set on at least the first task", () => {
    const data = createDefaultGanttData();
    const firstTask = data.sections[0].tasks[0];
    expect(firstTask.startDate).toBeTruthy();
    expect(firstTask.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
