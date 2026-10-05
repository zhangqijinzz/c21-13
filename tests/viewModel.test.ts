import { describe, expect, it } from "vitest";
import {
  createProject,
  duplicateProjectById,
  selectProject,
} from "../src/features/projects/projectViewModel";
import {
  compareScenarios,
  restoreScenario,
  saveScenario,
} from "../src/features/scenarios/scenarioViewModel";
import { simulateProject } from "../src/shared/domain/simulation";
import {
  EXAMPLE_PROJECT,
  type LatencyProject,
  type WorkspaceDocument,
} from "../src/shared/domain/types";

function workspaceOf(
  projects: LatencyProject[],
  activeProjectId: string,
): WorkspaceDocument {
  return { version: 1, activeProjectId, projects };
}

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

  it("duplicates the project that the row points at, not the active one", () => {
    const other: LatencyProject = {
      ...structuredClone(EXAMPLE_PROJECT),
      id: "project-other",
      title: "另一个项目",
    };
    const initial = workspaceOf([other, EXAMPLE_PROJECT], EXAMPLE_PROJECT.id);
    const duplicated = duplicateProjectById(initial, other.id, 10);
    expect(duplicated).toBeDefined();
    const copy = duplicated!.projects[0]!;
    expect(copy.title).toBe("另一个项目 · 副本");
    expect(copy.id).not.toBe(other.id);
    // 复制非当前项目时，正在编辑的上下文不能被无声切掉。
    expect(duplicated!.activeProjectId).toBe(EXAMPLE_PROJECT.id);
  });

  it("keeps the active project untouched when duplicating the active row", () => {
    const initial = workspaceOf([EXAMPLE_PROJECT], EXAMPLE_PROJECT.id);
    const duplicated = duplicateProjectById(initial, EXAMPLE_PROJECT.id, 10)!;
    expect(duplicated.activeProjectId).toBe(EXAMPLE_PROJECT.id);
    expect(duplicated.projects[0]?.id).not.toBe(EXAMPLE_PROJECT.id);
  });

  it("remaps a duplicate's dependency and fallback identities", () => {
    const initial = workspaceOf([EXAMPLE_PROJECT], EXAMPLE_PROJECT.id);
    const duplicated = duplicateProjectById(
      initial,
      EXAMPLE_PROJECT.id,
      10,
    )!;
    const copy = duplicated.projects[0]!;
    expect(copy.nodes[2]?.dependencyIds).toEqual([copy.nodes[0]?.id]);
    expect(copy.nodes[4]?.fallbackNodeId).toBe(copy.nodes[3]?.id);
    expect(copy.id).not.toBe(EXAMPLE_PROJECT.id);
    for (const node of copy.nodes) {
      expect(EXAMPLE_PROJECT.nodes.some((source) => source.id === node.id)).toBe(
        false,
      );
    }
  });

  it("carries scenario snapshots over with identities scoped to the copy", () => {
    const saved = saveScenario(
      EXAMPLE_PROJECT,
      simulateProject(EXAMPLE_PROJECT),
      "基线方案",
    );
    const initial = workspaceOf([saved], saved.id);
    const duplicated = duplicateProjectById(initial, saved.id, 20)!;
    const copy = duplicated.projects[0]!;
    expect(copy.scenarios).toHaveLength(1);
    const snapshot = copy.scenarios[0]!;
    expect(snapshot.id).not.toBe(saved.scenarios[0]!.id);
    // 快照内的节点与当前图共享同一套副本 id，恢复后仍是本副本的节点。
    const liveIds = new Set(copy.nodes.map((node) => node.id));
    for (const node of snapshot.nodes) {
      expect(liveIds.has(node.id)).toBe(true);
      expect(node.id).not.toBe(
        saved.nodes.find((source) => source.name === node.name)?.id,
      );
    }
    const restoredNodeIds = restoreScenario(copy, snapshot.id).nodes.map(
      (node) => node.id,
    );
    expect(restoredNodeIds).toEqual(copy.nodes.map((node) => node.id));
    for (const nodeId of snapshot.criticalPath) {
      expect(liveIds.has(nodeId)).toBe(true);
    }
  });

  it("avoids duplicate copy names when a copy already exists", () => {
    const once = duplicateProjectById(
      workspaceOf([EXAMPLE_PROJECT], EXAMPLE_PROJECT.id),
      EXAMPLE_PROJECT.id,
      10,
    )!;
    const twice = duplicateProjectById(once, EXAMPLE_PROJECT.id, 20)!;
    expect(twice.projects[0]?.title).toBe("商品详情页 · 首屏预算 · 副本 2");
    const thrice = duplicateProjectById(twice, EXAMPLE_PROJECT.id, 30)!;
    expect(thrice.projects[0]?.title).toBe("商品详情页 · 首屏预算 · 副本 3");
  });

  it("returns undefined when the row points at a deleted project", () => {
    const initial = workspaceOf([EXAMPLE_PROJECT], EXAMPLE_PROJECT.id);
    expect(duplicateProjectById(initial, "project-gone", 10)).toBeUndefined();
    // 文档不发生任何变化。
    expect(initial.projects).toEqual([EXAMPLE_PROJECT]);
    expect(initial.activeProjectId).toBe(EXAMPLE_PROJECT.id);
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
