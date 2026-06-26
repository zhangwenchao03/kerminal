import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  ContainerRuntime,
  RemoteTargetRef,
  TargetCapabilities,
} from "./targetModel";
import {
  dockerContainerTarget,
  dockerContainerTargetCapabilities,
} from "./targetModel";

export type DockerContainerStatus =
  | "running"
  | "exited"
  | "paused"
  | "restarting"
  | "created"
  | "dead"
  | "unknown";

export type DockerContainerLifecycleAction =
  | "start"
  | "stop"
  | "restart"
  | "remove";

export type DockerComposeRuntimeFamily = "dockerCompose" | "podmanCompose";

export interface DockerComposeMetadata {
  project?: string | null;
  service?: string | null;
  workingDir?: string | null;
  configFiles?: string[] | null;
  configPaths?: string[] | null;
  containerNumber?: string | null;
  oneoff?: boolean | null;
  runtimeFamily?: string | null;
}

export interface DockerContainerListRequest {
  hostId: string;
  runtime?: ContainerRuntime;
  includeStopped?: boolean;
}

export interface DockerContainerLifecycleRequest {
  hostId: string;
  containerId: string;
  runtime?: ContainerRuntime;
  force?: boolean;
}

export interface DockerContainerLifecycleResult {
  hostId: string;
  containerId: string;
  runtime: ContainerRuntime;
  action: DockerContainerLifecycleAction;
  success: boolean;
  output: string;
}

export interface DockerContainerInfoRequest {
  hostId: string;
  containerId: string;
  runtime?: ContainerRuntime;
}

export interface DockerContainerInspectSummary {
  hostId: string;
  containerId: string;
  runtime: ContainerRuntime;
  id: string;
  name: string;
  image: string;
  status: string;
  running: boolean;
  created?: string;
  startedAt?: string;
  finishedAt?: string;
  entrypoint: string[];
  command: string[];
  workingDir?: string;
  user?: string;
  ports: string[];
  networks: string[];
  labels: Record<string, string>;
  rawJson: string;
}

export interface DockerContainerLogsRequest extends DockerContainerInfoRequest {
  tail?: number;
}

export interface DockerContainerLogsResult {
  hostId: string;
  containerId: string;
  runtime: ContainerRuntime;
  tail: number;
  logs: string;
}

export type DockerContainerStatsRequest = DockerContainerInfoRequest;

export interface DockerContainerStatsResult {
  hostId: string;
  containerId: string;
  runtime: ContainerRuntime;
  cpuPercent?: string;
  memoryUsage?: string;
  memoryPercent?: string;
  networkIo?: string;
  blockIo?: string;
  pids?: string;
  raw: string;
}

export interface DockerContainerSummary {
  hostId: string;
  id: string;
  shortId: string;
  name: string;
  image: string;
  statusText: string;
  status: DockerContainerStatus;
  state: string;
  ports: string[];
  runtime: ContainerRuntime;
  target: RemoteTargetRef;
  capabilities: TargetCapabilities;
  compose?: DockerComposeMetadata | null;
  labels?: Record<string, string>;
}

export async function listDockerContainers(
  request: DockerContainerListRequest,
): Promise<DockerContainerSummary[]> {
  const normalized = normalizeListRequest(request);
  if (!isTauri()) {
    return browserPreviewContainers(normalized);
  }

  return invoke<DockerContainerSummary[]>("docker_list_containers", {
    request: normalized,
  });
}

export function startDockerContainer(
  request: DockerContainerLifecycleRequest,
): Promise<DockerContainerLifecycleResult> {
  return runDockerContainerLifecycleAction("start", request);
}

export function stopDockerContainer(
  request: DockerContainerLifecycleRequest,
): Promise<DockerContainerLifecycleResult> {
  return runDockerContainerLifecycleAction("stop", request);
}

export function restartDockerContainer(
  request: DockerContainerLifecycleRequest,
): Promise<DockerContainerLifecycleResult> {
  return runDockerContainerLifecycleAction("restart", request);
}

export function removeDockerContainer(
  request: DockerContainerLifecycleRequest,
): Promise<DockerContainerLifecycleResult> {
  return runDockerContainerLifecycleAction("remove", request);
}

export async function inspectDockerContainer(
  request: DockerContainerInfoRequest,
): Promise<DockerContainerInspectSummary> {
  const normalized = normalizeInfoRequest(request);
  if (!isTauri()) {
    return browserPreviewInspect(normalized);
  }

  return invoke<DockerContainerInspectSummary>("docker_inspect_container", {
    request: normalized,
  });
}

export async function tailDockerContainerLogs(
  request: DockerContainerLogsRequest,
): Promise<DockerContainerLogsResult> {
  const normalized = normalizeLogsRequest(request);
  if (!isTauri()) {
    return {
      containerId: normalized.containerId,
      hostId: normalized.hostId,
      logs: "2026-06-25T08:00:01Z boot complete\n2026-06-25T08:00:04Z listening on :8080",
      runtime: normalized.runtime,
      tail: normalized.tail,
    };
  }

  return invoke<DockerContainerLogsResult>("docker_tail_container_logs", {
    request: normalized,
  });
}

export async function fetchDockerContainerStats(
  request: DockerContainerStatsRequest,
): Promise<DockerContainerStatsResult> {
  const normalized = normalizeInfoRequest(request);
  if (!isTauri()) {
    return {
      blockIo: "0B / 0B",
      containerId: normalized.containerId,
      cpuPercent: "0.42%",
      hostId: normalized.hostId,
      memoryPercent: "4.1%",
      memoryUsage: "42MiB / 1GiB",
      networkIo: "1kB / 2kB",
      pids: "7",
      raw: '{"CPUPerc":"0.42%","MemUsage":"42MiB / 1GiB"}',
      runtime: normalized.runtime,
    };
  }

  return invoke<DockerContainerStatsResult>("docker_container_stats", {
    request: normalized,
  });
}

function normalizeListRequest(
  request: DockerContainerListRequest,
): Required<DockerContainerListRequest> {
  return {
    hostId: request.hostId.trim(),
    includeStopped: request.includeStopped ?? true,
    runtime: request.runtime ?? "docker",
  };
}

async function runDockerContainerLifecycleAction(
  action: DockerContainerLifecycleAction,
  request: DockerContainerLifecycleRequest,
): Promise<DockerContainerLifecycleResult> {
  const normalized = normalizeLifecycleRequest(request);
  if (!isTauri()) {
    return {
      action,
      containerId: normalized.containerId,
      hostId: normalized.hostId,
      output: `${action}:${normalized.containerId}`,
      runtime: normalized.runtime,
      success: true,
    };
  }

  return invoke<DockerContainerLifecycleResult>(`docker_${action}_container`, {
    request: normalized,
  });
}

function normalizeLifecycleRequest(
  request: DockerContainerLifecycleRequest,
): Required<DockerContainerLifecycleRequest> {
  return {
    containerId: request.containerId.trim(),
    force: request.force ?? false,
    hostId: request.hostId.trim(),
    runtime: request.runtime ?? "docker",
  };
}

function normalizeInfoRequest(
  request: DockerContainerInfoRequest,
): Required<DockerContainerInfoRequest> {
  return {
    containerId: request.containerId.trim(),
    hostId: request.hostId.trim(),
    runtime: request.runtime ?? "docker",
  };
}

function normalizeLogsRequest(
  request: DockerContainerLogsRequest,
): Required<DockerContainerLogsRequest> {
  return {
    ...normalizeInfoRequest(request),
    tail: Math.min(Math.max(Math.trunc(request.tail ?? 200), 1), 1000),
  };
}

function browserPreviewContainers(
  request: Required<DockerContainerListRequest>,
): DockerContainerSummary[] {
  const containers = [
    previewContainer(request.hostId, {
      compose: {
        configFiles: ["compose.yaml", "compose.override.yaml"],
        configPaths: [
          "/srv/kerminal/compose.yaml",
          "/srv/kerminal/compose.override.yaml",
        ],
        containerNumber: "1",
        oneoff: false,
        project: "kerminal",
        runtimeFamily: "dockerCompose",
        service: "api",
        workingDir: "/srv/kerminal",
      },
      id: "c0ffee1234567890",
      image: "kerminal/api:latest",
      labels: {
        "com.docker.compose.container-number": "1",
        "com.docker.compose.project": "kerminal",
        "com.docker.compose.project.config_files":
          "compose.yaml,compose.override.yaml",
        "com.docker.compose.project.working_dir": "/srv/kerminal",
        "com.docker.compose.service": "api",
      },
      name: "kerminal-api-1",
      ports: ["0.0.0.0:8080->80/tcp"],
      state: "running",
      status: "running",
      statusText: "Up 12 minutes",
    }),
    previewContainer(request.hostId, {
      compose: {
        configFiles: ["compose.yaml", "compose.override.yaml"],
        configPaths: [
          "/srv/kerminal/compose.yaml",
          "/srv/kerminal/compose.override.yaml",
        ],
        containerNumber: "1",
        oneoff: false,
        project: "kerminal",
        runtimeFamily: "dockerCompose",
        service: "worker",
        workingDir: "/srv/kerminal",
      },
      id: "feedface98765432",
      image: "kerminal/worker:latest",
      labels: {
        "com.docker.compose.container-number": "1",
        "com.docker.compose.project": "kerminal",
        "com.docker.compose.project.config_files":
          "compose.yaml,compose.override.yaml",
        "com.docker.compose.project.working_dir": "/srv/kerminal",
        "com.docker.compose.service": "worker",
      },
      name: "kerminal-worker-1",
      ports: [],
      state: "exited",
      status: "exited",
      statusText: "Exited (0) 2 hours ago",
    }),
    previewContainer(request.hostId, {
      id: "deadbeef98765432",
      image: "redis:7",
      labels: {},
      name: "redis-cache",
      ports: ["6379/tcp"],
      state: "running",
      status: "running",
      statusText: "Up 31 minutes",
    }),
  ];

  return request.includeStopped
    ? containers
    : containers.filter((container) => container.status === "running");
}

function previewContainer(
  hostId: string,
  input: {
    id: string;
    image: string;
    compose?: DockerComposeMetadata;
    labels?: Record<string, string>;
    name: string;
    ports: string[];
    state: string;
    status: DockerContainerStatus;
    statusText: string;
  },
): DockerContainerSummary {
  const target = dockerContainerTarget({
    containerId: input.id,
    containerName: input.name,
    hostId,
  });
  return {
    capabilities: dockerContainerTargetCapabilities,
    ...(input.compose ? { compose: input.compose } : {}),
    hostId,
    id: input.id,
    image: input.image,
    ...(input.labels ? { labels: input.labels } : {}),
    name: input.name,
    ports: input.ports,
    runtime: "docker",
    shortId: input.id.slice(0, 12),
    state: input.state,
    status: input.status,
    statusText: input.statusText,
    target,
  };
}

function browserPreviewInspect(
  request: Required<DockerContainerInfoRequest>,
): DockerContainerInspectSummary {
  const isStandalone = request.containerId === "deadbeef98765432";
  const isWorker = request.containerId === "feedface98765432";
  const name = isStandalone
    ? "redis-cache"
    : isWorker
      ? "kerminal-worker-1"
      : "kerminal-api-1";
  const image = isStandalone
    ? "redis:7"
    : isWorker
      ? "kerminal/worker:latest"
      : "kerminal/api:latest";
  const labels: Record<string, string> = isStandalone
    ? {}
    : {
        "com.docker.compose.container-number": "1",
        "com.docker.compose.project": "kerminal",
        "com.docker.compose.project.config_files":
          "compose.yaml,compose.override.yaml",
        "com.docker.compose.project.working_dir": "/srv/kerminal",
        "com.docker.compose.service": isWorker ? "worker" : "api",
      };
  return {
    command: ["serve"],
    containerId: request.containerId,
    created: "2026-06-25T08:00:00Z",
    entrypoint: ["/entrypoint.sh"],
    finishedAt: "0001-01-01T00:00:00Z",
    hostId: request.hostId,
    id: request.containerId,
    image,
    labels,
    name,
    networks: ["bridge"],
    ports: isStandalone
      ? ["6379/tcp"]
      : isWorker
        ? []
        : ["0.0.0.0:8080->80/tcp"],
    rawJson: JSON.stringify(
      { Config: { Image: image }, Name: `/${name}` },
      null,
      2,
    ),
    running: !isWorker,
    runtime: request.runtime,
    startedAt: "2026-06-25T08:01:00Z",
    status: isWorker ? "exited" : "running",
    user: "app",
    workingDir: "/srv/app",
  };
}
