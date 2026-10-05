import {
  createEmptyProject,
  type LatencyProject,
  type RequestNode,
  type WorkspaceDocument,
} from "../../shared/domain/types";

export function createProject(
  document: WorkspaceDocument,
  now = Date.now(),
): WorkspaceDocument {
  const project = createEmptyProject(now);
  return {
    ...document,
    activeProjectId: project.id,
    projects: [project, ...document.projects],
  };
}

export function selectProject(
  document: WorkspaceDocument,
  projectId: string,
): WorkspaceDocument {
  return document.projects.some((project) => project.id === projectId)
    ? { ...document, activeProjectId: projectId }
    : document;
}

export function renameProject(
  project: LatencyProject,
  title: string,
  now = Date.now(),
): LatencyProject {
  return { ...project, title: title.trim() || "未命名链路", updatedAt: now };
}

function uniqueCopyTitle(sourceTitle: string, existing: LatencyProject[]): string {
  const used = new Set(existing.map((project) => project.title));
  const candidate = (suffix: number) =>
    suffix === 0
      ? `${sourceTitle} · 副本`
      : `${sourceTitle} · 副本 ${suffix + 1}`;
  let suffix = 0;
  while (used.has(candidate(suffix))) suffix += 1;
  return candidate(suffix);
}

/**
 * One identity map is shared across the live graph and every scenario
 * snapshot, so a node keeps a single id inside the copy: restoring a snapshot
 * and comparing two snapshots both continue to line up by node id.
 * Snapshot-only nodes (deleted from the live graph) get fresh ids too.
 */
function mappedNodeId(
  originalId: string,
  idMap: Map<string, string>,
): string {
  let mapped = idMap.get(originalId);
  if (!mapped) {
    mapped = `node-${crypto.randomUUID()}`;
    idMap.set(originalId, mapped);
  }
  return mapped;
}

function remapNode(
  source: RequestNode,
  idMap: Map<string, string>,
): RequestNode {
  const fallbackNodeId = source.fallbackNodeId
    ? mappedNodeId(source.fallbackNodeId, idMap)
    : undefined;
  return {
    ...source,
    id: mappedNodeId(source.id, idMap),
    dependencyIds: source.dependencyIds
      .map((dependencyId) => mappedNodeId(dependencyId, idMap))
      .filter((dependencyId) => dependencyId !== idMap.get(source.id)),
    ...(fallbackNodeId ? { fallbackNodeId } : {}),
  };
}

/**
 * Duplicate the project identified by projectId. Returns undefined when the
 * row points at a project that no longer exists. The active project is never
 * changed here: the copy is created without stealing the editing context.
 */
export function duplicateProjectById(
  document: WorkspaceDocument,
  projectId: string,
  now = Date.now(),
): WorkspaceDocument | undefined {
  const source = document.projects.find((project) => project.id === projectId);
  if (!source) return undefined;

  const idMap = new Map<string, string>();
  // Pre-seed the live graph so edges pointing at later nodes share the same id.
  source.nodes.forEach((node) => mappedNodeId(node.id, idMap));
  const nodes = source.nodes.map((node) => remapNode(node, idMap));
  const scenarios = source.scenarios.map((scenario) => {
    const snapshotNodes = scenario.nodes.map((node) => remapNode(node, idMap));
    const snapshotNodeIds = new Set(snapshotNodes.map((node) => node.id));
    return {
      ...structuredClone(scenario),
      id: `scenario-${crypto.randomUUID()}`,
      nodes: snapshotNodes,
      criticalPath: scenario.criticalPath
        .map((nodeId) => idMap.get(nodeId))
        .filter(
          (nodeId): nodeId is string =>
            Boolean(nodeId) && snapshotNodeIds.has(nodeId as string),
        ),
    };
  });

  const copy: LatencyProject = {
    ...structuredClone(source),
    id: `project-${crypto.randomUUID()}`,
    title: uniqueCopyTitle(source.title, document.projects),
    createdAt: now,
    updatedAt: now,
    nodes,
    scenarios,
  };

  return {
    ...document,
    activeProjectId: document.activeProjectId,
    projects: [copy, ...document.projects],
  };
}

export function removeProject(
  document: WorkspaceDocument,
  projectId: string,
): WorkspaceDocument {
  const projects = document.projects.filter(
    (project) => project.id !== projectId,
  );
  return {
    ...document,
    projects,
    activeProjectId:
      document.activeProjectId === projectId
        ? (projects[0]?.id ?? "")
        : document.activeProjectId,
  };
}

export function updateProject(
  document: WorkspaceDocument,
  project: LatencyProject,
): WorkspaceDocument {
  return {
    ...document,
    projects: document.projects.map((item) =>
      item.id === project.id ? project : item,
    ),
  };
}
