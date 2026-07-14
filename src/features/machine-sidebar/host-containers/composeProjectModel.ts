/**
 * Compose-aware host container project view model.
 *
 * @author kongweiguang
 */

import type {
  DockerContainerStatus,
  DockerContainerSummary,
} from "../../../lib/dockerApi";
import type { ContainerRuntime } from "../../../lib/targetModel";

type ComposeRuntimeFamily = "docker" | "podman" | "unknown";

interface DockerComposeContainerMetadata {
  project?: string | null;
  service?: string | null;
  workingDir?: string | null;
  configFiles?: string[] | null;
  configPaths?: string[] | null;
  containerNumber?: string | null;
  oneoff?: boolean | null;
  runtimeFamily?: string | null;
}

export type ComposeProjectContainerSummary = Omit<
  DockerContainerSummary,
  "compose"
> & {
  compose?: DockerComposeContainerMetadata | null;
};

export interface ComposeConfigPathResolution {
  configFiles: string[];
  configPaths: string[];
  warnings: string[];
  workingDir?: string;
}

interface ComposeContainerView {
  container: ComposeProjectContainerSummary;
  containerNumber?: string;
  id: string;
  image: string;
  name: string;
  oneoff: boolean;
  ports: string[];
  searchText: string;
  service: string;
  status: DockerContainerStatus;
  statusText: string;
}

interface ComposeServiceView {
  containers: ComposeContainerView[];
  errorCount: number;
  id: string;
  runningCount: number;
  service: string;
  stoppedCount: number;
  totalCount: number;
}

export interface ComposeProjectView {
  configFiles: string[];
  configPaths: string[];
  containers: ComposeContainerView[];
  errorCount: number;
  id: string;
  project: string;
  runningCount: number;
  runtime: ContainerRuntime;
  runtimeFamily: ComposeRuntimeFamily;
  searchText: string;
  services: ComposeServiceView[];
  stoppedCount: number;
  totalCount: number;
  warningCount: number;
  warnings: string[];
  workingDir?: string;
}

export interface ComposeStandaloneContainerView {
  container: ComposeProjectContainerSummary;
  id: string;
  image: string;
  name: string;
  ports: string[];
  runtime: ContainerRuntime;
  searchText: string;
  status: DockerContainerStatus;
  statusText: string;
}

export interface ComposeProjectViews {
  errorCount: number;
  projects: ComposeProjectView[];
  runningCount: number;
  standaloneContainers: ComposeStandaloneContainerView[];
  stoppedCount: number;
  totalCount: number;
  warningCount: number;
  warnings: string[];
}

const dockerComposeLabels = {
  configFiles: "com.docker.compose.project.config_files",
  containerNumber: "com.docker.compose.container-number",
  oneoff: "com.docker.compose.oneoff",
  project: "com.docker.compose.project",
  service: "com.docker.compose.service",
  workingDir: "com.docker.compose.project.working_dir",
} as const;

const podmanComposeLabels = {
  configFiles: "io.podman.compose.project.config_files",
  project: "io.podman.compose.project",
  service: "io.podman.compose.service",
  workingDir: "io.podman.compose.project.working_dir",
} as const;

const statusSortOrder: Record<DockerContainerStatus, number> = {
  running: 0,
  restarting: 1,
  paused: 2,
  created: 3,
  exited: 4,
  dead: 5,
  unknown: 6,
};

export function buildComposeProjectViews(
  containers: ComposeProjectContainerSummary[],
): ComposeProjectViews {
  const projectContainers = new Map<string, ComposeProjectContainerSummary[]>();
  const standaloneContainers: ComposeProjectContainerSummary[] = [];

  for (const container of containers) {
    const project = readContainerComposeProject(container);
    if (!project) {
      standaloneContainers.push(container);
      continue;
    }
    const key = composeProjectKey(container, project);
    projectContainers.set(key, [
      ...(projectContainers.get(key) ?? []),
      container,
    ]);
  }

  const projects = [...projectContainers.values()]
    .map(buildComposeProjectView)
    .sort(compareComposeProjects);
  const standaloneViews = sortContainers(standaloneContainers).map(
    buildStandaloneContainerView,
  );
  const stats = containerStats(containers);
  const warnings = projects.flatMap((project) =>
    project.warnings.map((warning) => `${project.project}: ${warning}`),
  );

  return {
    errorCount: stats.errorCount,
    projects,
    runningCount: stats.runningCount,
    standaloneContainers: standaloneViews,
    stoppedCount: stats.stoppedCount,
    totalCount: stats.totalCount,
    warningCount: warnings.length,
    warnings,
  };
}

export function readContainerComposeProject(
  container: ComposeProjectContainerSummary,
) {
  return (
    trimText(container.compose?.project) ||
    readLabel(container, dockerComposeLabels.project) ||
    readLabel(container, podmanComposeLabels.project) ||
    ""
  );
}

export function readContainerComposeService(
  container: ComposeProjectContainerSummary,
) {
  return (
    trimText(container.compose?.service) ||
    readLabel(container, dockerComposeLabels.service) ||
    readLabel(container, podmanComposeLabels.service) ||
    ""
  );
}

export function readContainerComposeConfigPaths(
  container: ComposeProjectContainerSummary,
) {
  return readContainerComposeConfigPathResolution(container).configPaths;
}

function readContainerComposeConfigPathResolution(
  container: ComposeProjectContainerSummary,
): ComposeConfigPathResolution {
  return resolveComposeConfigPaths({
    configFiles: readContainerComposeConfigFiles(container),
    configPaths: firstNonEmptyStringList([
      readStringList(container.compose?.configPaths),
    ]),
    workingDir: readContainerComposeWorkingDir(container),
  });
}

function resolveComposeConfigPaths({
  configFiles = [],
  configPaths = [],
  workingDir,
}: {
  configFiles?: string[];
  configPaths?: string[];
  workingDir?: string;
}): ComposeConfigPathResolution {
  const normalizedWorkingDir = trimText(workingDir);
  const normalizedConfigFiles = uniqueStrings(configFiles);
  const normalizedConfigPaths = uniqueStrings(configPaths);
  const warnings: string[] = [];

  if (normalizedConfigPaths.length > 0) {
    return {
      configFiles: normalizedConfigFiles,
      configPaths: normalizedConfigPaths,
      warnings,
      ...(normalizedWorkingDir ? { workingDir: normalizedWorkingDir } : {}),
    };
  }

  if (normalizedConfigFiles.length === 0) {
    warnings.push("未发现 Compose YAML 路径");
    return {
      configFiles: [],
      configPaths: [],
      warnings,
      ...(normalizedWorkingDir ? { workingDir: normalizedWorkingDir } : {}),
    };
  }

  const unresolvedRelativePaths = normalizedConfigFiles.some(
    (path) => !isAbsolutePath(path),
  );
  if (unresolvedRelativePaths && !normalizedWorkingDir) {
    warnings.push("Compose YAML 包含相对路径但缺少 workingDir");
  }

  return {
    configFiles: normalizedConfigFiles,
    configPaths: normalizedConfigFiles.map((path) =>
      resolveComposeConfigPath(path, normalizedWorkingDir),
    ),
    warnings,
    ...(normalizedWorkingDir ? { workingDir: normalizedWorkingDir } : {}),
  };
}

export function composeProjectMatchesQuery(
  project: ComposeProjectView,
  query: string,
) {
  const normalizedQuery = normalizeSearch(query);
  return !normalizedQuery || project.searchText.includes(normalizedQuery);
}

export function composeStandaloneContainerMatchesQuery(
  container: ComposeStandaloneContainerView,
  query: string,
) {
  const normalizedQuery = normalizeSearch(query);
  return !normalizedQuery || container.searchText.includes(normalizedQuery);
}

function buildComposeProjectView(
  containers: ComposeProjectContainerSummary[],
): ComposeProjectView {
  const sortedContainers = sortContainers(containers);
  const firstContainer = sortedContainers[0]!;
  const project = readContainerComposeProject(firstContainer);
  const runtimeFamily = readContainerComposeRuntimeFamily(firstContainer);
  const config = resolveProjectConfig(sortedContainers);
  const containerViews = sortedContainers.map((container) =>
    buildComposeContainerView(container),
  );
  const services = buildComposeServiceViews(containerViews, project);
  const stats = containerStats(sortedContainers);
  const searchText = buildSearchText([
    project,
    firstContainer.runtime,
    runtimeFamily,
    config.workingDir,
    ...config.configPaths,
    ...config.configFiles,
    ...containerViews.map((container) => container.searchText),
  ]);

  return {
    configFiles: config.configFiles,
    configPaths: config.configPaths,
    containers: containerViews,
    errorCount: stats.errorCount,
    id: composeProjectId(firstContainer, project),
    project,
    runningCount: stats.runningCount,
    runtime: firstContainer.runtime,
    runtimeFamily,
    searchText,
    services,
    stoppedCount: stats.stoppedCount,
    totalCount: stats.totalCount,
    warningCount: config.warnings.length,
    warnings: config.warnings,
    ...(config.workingDir ? { workingDir: config.workingDir } : {}),
  };
}

function buildComposeContainerView(
  container: ComposeProjectContainerSummary,
): ComposeContainerView {
  const service = readContainerComposeService(container) || "other";
  return {
    container,
    ...(readContainerComposeContainerNumber(container)
      ? { containerNumber: readContainerComposeContainerNumber(container) }
      : {}),
    id: container.id,
    image: container.image,
    name: container.name,
    oneoff: readContainerComposeOneoff(container),
    ports: container.ports,
    searchText: buildContainerSearchText(container, [
      readContainerComposeProject(container),
      service,
      ...readContainerComposeConfigPaths(container),
    ]),
    service,
    status: container.status,
    statusText: container.statusText,
  };
}

function buildComposeServiceViews(
  containers: ComposeContainerView[],
  project: string,
): ComposeServiceView[] {
  const serviceContainers = new Map<string, ComposeContainerView[]>();
  for (const container of containers) {
    serviceContainers.set(container.service, [
      ...(serviceContainers.get(container.service) ?? []),
      container,
    ]);
  }

  return [...serviceContainers.entries()]
    .map(([service, serviceContainerViews]) => {
      const stats = containerStats(
        serviceContainerViews.map((container) => container.container),
      );
      return {
        containers: serviceContainerViews,
        errorCount: stats.errorCount,
        id: `${project}:service:${service}`,
        runningCount: stats.runningCount,
        service,
        stoppedCount: stats.stoppedCount,
        totalCount: stats.totalCount,
      };
    })
    .sort(compareComposeServices);
}

function buildStandaloneContainerView(
  container: ComposeProjectContainerSummary,
): ComposeStandaloneContainerView {
  return {
    container,
    id: container.id,
    image: container.image,
    name: container.name,
    ports: container.ports,
    runtime: container.runtime,
    searchText: buildContainerSearchText(container),
    status: container.status,
    statusText: container.statusText,
  };
}

function resolveProjectConfig(
  containers: ComposeProjectContainerSummary[],
): ComposeConfigPathResolution {
  const workingDirs = uniqueStrings(
    containers.map(readContainerComposeWorkingDir),
  );
  const resolutions = containers.map(readContainerComposeConfigPathResolution);
  const configFiles = firstNonEmptyStringList(
    resolutions.map((resolution) => resolution.configFiles),
  );
  const configPaths = firstNonEmptyStringList(
    resolutions.map((resolution) => resolution.configPaths),
  );
  const warnings: string[] = [];
  const pathSets = uniqueStrings(
    resolutions
      .map((resolution) => resolution.configPaths.join("\n"))
      .filter(Boolean),
  );

  if (workingDirs.length > 1) {
    warnings.push("同一 Compose 项目存在多个 workingDir");
  }
  if (pathSets.length > 1) {
    warnings.push("同一 Compose 项目存在多组 Compose YAML 路径");
  }
  if (configPaths.length === 0) {
    warnings.push("未发现 Compose YAML 路径");
  }
  if (
    configFiles.some((path) => !isAbsolutePath(path)) &&
    workingDirs.length === 0
  ) {
    warnings.push("Compose YAML 包含相对路径但缺少 workingDir");
  }

  return {
    configFiles,
    configPaths,
    warnings: uniqueStrings(warnings),
    ...(workingDirs[0] ? { workingDir: workingDirs[0] } : {}),
  };
}

function readContainerComposeWorkingDir(
  container: ComposeProjectContainerSummary,
) {
  return (
    trimText(container.compose?.workingDir) ||
    readLabel(container, dockerComposeLabels.workingDir) ||
    readLabel(container, podmanComposeLabels.workingDir) ||
    ""
  );
}

function readContainerComposeConfigFiles(
  container: ComposeProjectContainerSummary,
) {
  return firstNonEmptyStringList([
    readStringList(container.compose?.configFiles),
    splitComposeConfigFiles(
      readLabel(container, dockerComposeLabels.configFiles),
    ),
    splitComposeConfigFiles(
      readLabel(container, podmanComposeLabels.configFiles),
    ),
  ]);
}

function readContainerComposeContainerNumber(
  container: ComposeProjectContainerSummary,
) {
  return (
    trimText(container.compose?.containerNumber) ||
    readLabel(container, dockerComposeLabels.containerNumber) ||
    ""
  );
}

function readContainerComposeOneoff(container: ComposeProjectContainerSummary) {
  const oneoff = container.compose?.oneoff;
  if (typeof oneoff === "boolean") {
    return oneoff;
  }
  return (
    readLabel(container, dockerComposeLabels.oneoff).toLowerCase() === "true"
  );
}

function readContainerComposeRuntimeFamily(
  container: ComposeProjectContainerSummary,
): ComposeRuntimeFamily {
  const runtimeFamily = (
    trimText(container.compose?.runtimeFamily)
  ).toLowerCase();
  if (runtimeFamily.includes("podman")) {
    return "podman";
  }
  if (runtimeFamily.includes("docker")) {
    return "docker";
  }
  if (readLabel(container, podmanComposeLabels.project)) {
    return "podman";
  }
  if (readLabel(container, dockerComposeLabels.project)) {
    return "docker";
  }
  return container.runtime === "podman" ? "podman" : "docker";
}

function composeProjectKey(
  container: ComposeProjectContainerSummary,
  project: string,
) {
  return `${container.runtime}:${readContainerComposeRuntimeFamily(
    container,
  )}:${project}`;
}

function composeProjectId(
  container: ComposeProjectContainerSummary,
  project: string,
) {
  return `compose:${composeProjectKey(container, project)}`;
}

function containerStats(containers: ComposeProjectContainerSummary[]) {
  const runningCount = containers.filter(
    (container) => container.status === "running",
  ).length;
  const errorCount = containers.filter((container) =>
    isContainerErrorStatus(container.status),
  ).length;
  return {
    errorCount,
    runningCount,
    stoppedCount: containers.length - runningCount,
    totalCount: containers.length,
  };
}

function isContainerErrorStatus(status: DockerContainerStatus) {
  return status === "dead";
}

function sortContainers(containers: ComposeProjectContainerSummary[]) {
  return [...containers].sort(
    (left, right) =>
      statusSortOrder[left.status] - statusSortOrder[right.status] ||
      readContainerComposeProject(left).localeCompare(
        readContainerComposeProject(right),
      ) ||
      readContainerComposeService(left).localeCompare(
        readContainerComposeService(right),
      ) ||
      left.name.localeCompare(right.name),
  );
}

function compareComposeProjects(
  left: ComposeProjectView,
  right: ComposeProjectView,
) {
  return (
    right.runningCount - left.runningCount ||
    left.project.localeCompare(right.project)
  );
}

function compareComposeServices(
  left: ComposeServiceView,
  right: ComposeServiceView,
) {
  if (left.service === "other" || right.service === "other") {
    return left.service === "other" ? 1 : -1;
  }
  return (
    right.runningCount - left.runningCount ||
    left.service.localeCompare(right.service)
  );
}

function buildContainerSearchText(
  container: ComposeProjectContainerSummary,
  extraParts: Array<string | undefined> = [],
) {
  return buildSearchText([
    container.name,
    container.image,
    container.shortId,
    container.id,
    container.statusText,
    container.state,
    container.runtime,
    ...container.ports,
    ...extraParts,
  ]);
}

function buildSearchText(parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function normalizeSearch(query: string) {
  return query.trim().toLowerCase();
}

function readLabel(container: ComposeProjectContainerSummary, key: string) {
  return trimText(container.labels?.[key]);
}

function readStringList(
  value: Array<string | null | undefined> | null | undefined,
) {
  return uniqueStrings(value ?? []);
}

function splitComposeConfigFiles(value: string) {
  if (!value) {
    return [];
  }
  const separator = value.includes(",") ? "," : ";";
  return uniqueStrings(value.split(separator));
}

function firstNonEmptyStringList(lists: string[][]) {
  return lists.find((list) => list.length > 0) ?? [];
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = trimText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function trimText(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function resolveComposeConfigPath(path: string, workingDir: string) {
  if (!path || isAbsolutePath(path) || !workingDir) {
    return path;
  }
  const separator = workingDir.includes("\\") ? "\\" : "/";
  return `${workingDir.replace(/[\\/]+$/g, "")}${separator}${path.replace(
    /^[\\/]+/g,
    "",
  )}`;
}

function isAbsolutePath(path: string) {
  return (
    path.startsWith("/") ||
    path.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(path)
  );
}
