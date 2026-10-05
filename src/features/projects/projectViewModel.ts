import {
  createEmptyProject,
  type LatencyProject,
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

export type DuplicateProjectResult =
  | { status: "duplicated"; document: WorkspaceDocument; copy: LatencyProject }
  | { status: "missing" };

function uniqueCopyTitle(
  document: WorkspaceDocument,
  sourceTitle: string,
): string {
  const titles = new Set(document.projects.map((project) => project.title));
  const base = `${sourceTitle} · 副本`;
  if (!titles.has(base)) return base;
  let suffix = 2;
  while (titles.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

export function duplicateProject(
  document: WorkspaceDocument,
  projectId: string,
  now = Date.now(),
): DuplicateProjectResult {
  const sourceIndex = document.projects.findIndex(
    (project) => project.id === projectId,
  );
  const source = document.projects[sourceIndex];
  if (!source) return { status: "missing" };
  const idMap = new Map<string, string>();
  const clonedNodes = source.nodes.map((node) => {
    const id = crypto.randomUUID();
    idMap.set(node.id, id);
    return { ...node, id, dependencyIds: [], fallbackNodeId: undefined };
  });
  const copy: LatencyProject = {
    ...structuredClone(source),
    id: `project-${crypto.randomUUID()}`,
    title: uniqueCopyTitle(document, source.title),
    createdAt: now,
    updatedAt: now,
    scenarios: [],
    nodes: clonedNodes.map((node, index) => {
      const sourceNode = source.nodes[index];
      if (!sourceNode) return node;
      const fallbackId = sourceNode.fallbackNodeId
        ? idMap.get(sourceNode.fallbackNodeId)
        : undefined;
      return {
        ...node,
        dependencyIds: sourceNode.dependencyIds
          .map((id) => idMap.get(id))
          .filter((id): id is string => Boolean(id)),
        ...(fallbackId ? { fallbackNodeId: fallbackId } : {}),
      };
    }),
  };
  const projects = [...document.projects];
  projects.splice(sourceIndex + 1, 0, copy);
  return {
    status: "duplicated",
    document: { ...document, projects },
    copy,
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
