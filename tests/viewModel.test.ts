import { describe, expect, it } from "vitest";
import {
  createProject,
  duplicateProject,
  selectProject,
} from "../src/features/projects/projectViewModel";
import {
  compareScenarios,
  restoreScenario,
  saveScenario,
} from "../src/features/scenarios/scenarioViewModel";
import { simulateProject } from "../src/shared/domain/simulation";
import { EXAMPLE_PROJECT } from "../src/shared/domain/types";

describe("project and scenario view models", () => {
  it("creates a project and switches the active project", () => {
    const initial = {
      version: 1 as const,
      activeProjectId: EXAMPLE_PROJECT.id,
      projects: [EXAMPLE_PROJECT],
    };
    const created = createProject(initial, 100);
    expect(created.projects).toHaveLength(2);
    expect(created.activeProjectId).not.toBe(EXAMPLE_PROJECT.id);
    expect(selectProject(created, EXAMPLE_PROJECT.id).activeProjectId).toBe(
      EXAMPLE_PROJECT.id,
    );
  });

  it("duplicates a project and remaps its dependency identities", () => {
    const initial = {
      version: 1 as const,
      activeProjectId: EXAMPLE_PROJECT.id,
      projects: [EXAMPLE_PROJECT],
    };
    const outcome = duplicateProject(initial, EXAMPLE_PROJECT.id, 10);
    if (outcome.status !== "duplicated") throw new Error("Expected a copy");
    const copy = outcome.copy;
    expect(copy.nodes[2]?.dependencyIds).toEqual([copy.nodes[0]?.id]);
    expect(copy.nodes[4]?.fallbackNodeId).toBe(copy.nodes[3]?.id);
    expect(copy.id).not.toBe(EXAMPLE_PROJECT.id);
    expect(copy.scenarios).toEqual([]);
    expect(outcome.document.projects[1]?.id).toBe(copy.id);
  });

  it("duplicates the targeted row without switching the active project", () => {
    const other = {
      ...structuredClone(EXAMPLE_PROJECT),
      id: "project-other",
      title: "历史方案",
    };
    const initial = {
      version: 1 as const,
      activeProjectId: EXAMPLE_PROJECT.id,
      projects: [EXAMPLE_PROJECT, other],
    };
    const outcome = duplicateProject(initial, "project-other", 10);
    if (outcome.status !== "duplicated") throw new Error("Expected a copy");
    expect(outcome.copy.title).toBe("历史方案 · 副本");
    expect(outcome.document.activeProjectId).toBe(EXAMPLE_PROJECT.id);
    expect(outcome.document.projects.map((project) => project.id)).toEqual([
      EXAMPLE_PROJECT.id,
      "project-other",
      outcome.copy.id,
    ]);
  });

  it("deduplicates copy titles across repeated duplications", () => {
    const initial = {
      version: 1 as const,
      activeProjectId: EXAMPLE_PROJECT.id,
      projects: [EXAMPLE_PROJECT],
    };
    const first = duplicateProject(initial, EXAMPLE_PROJECT.id, 10);
    if (first.status !== "duplicated") throw new Error("Expected a copy");
    expect(first.copy.title).toBe(`${EXAMPLE_PROJECT.title} · 副本`);
    const second = duplicateProject(first.document, EXAMPLE_PROJECT.id, 20);
    if (second.status !== "duplicated") throw new Error("Expected a copy");
    expect(second.copy.title).toBe(`${EXAMPLE_PROJECT.title} · 副本 2`);
    const titles = second.document.projects.map((project) => project.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("reports a missing project instead of duplicating a stale row", () => {
    const initial = {
      version: 1 as const,
      activeProjectId: EXAMPLE_PROJECT.id,
      projects: [EXAMPLE_PROJECT],
    };
    expect(duplicateProject(initial, "project-gone", 10)).toEqual({
      status: "missing",
    });
  });

  it("saves a complete snapshot and restores its parameters", () => {
    const baseline = {
      ...EXAMPLE_PROJECT,
      nodes: EXAMPLE_PROJECT.nodes.slice(0, 2),
    };
    const result = simulateProject(baseline);
    const saved = saveScenario(baseline, result, "并发方案");
    expect(saved.scenarios).toHaveLength(1);
    const changed = {
      ...saved,
      nodes: saved.nodes.map((node) => ({ ...node, durationMs: 999 })),
    };
    const restored = restoreScenario(changed, saved.scenarios[0]?.id ?? "");
    expect(restored.nodes[0]?.durationMs).toBe(baseline.nodes[0]?.durationMs);
  });

  it("describes node and concurrency differences between snapshots", () => {
    const baseline = {
      ...EXAMPLE_PROJECT,
      nodes: EXAMPLE_PROJECT.nodes.slice(0, 2),
    };
    const baselineSnapshot = saveScenario(
      baseline,
      simulateProject(baseline),
      "不限并发",
    ).scenarios[0];
    const changed = {
      ...baseline,
      concurrencyLimit: 1,
      nodes: baseline.nodes.map((node, index) =>
        index === 0 ? { ...node, durationMs: 900 } : node,
      ),
    };
    const changedSnapshot = saveScenario(
      changed,
      simulateProject(changed),
      "串行优化",
    ).scenarios[0];
    if (!baselineSnapshot || !changedSnapshot)
      throw new Error("Scenario fixtures should be saved");
    const comparison = compareScenarios(baselineSnapshot, changedSnapshot);
    expect(comparison.deltaMs).toBeGreaterThan(0);
    expect(comparison.changes.join(" ")).toContain("并发上限");
    expect(comparison.changes.join(" ")).toContain("耗时");
  });
});
