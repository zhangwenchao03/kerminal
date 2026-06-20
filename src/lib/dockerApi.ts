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

export interface DockerContainerListRequest {
  hostId: string;
  runtime?: ContainerRuntime;
  includeStopped?: boolean;
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

function normalizeListRequest(
  request: DockerContainerListRequest,
): Required<DockerContainerListRequest> {
  return {
    hostId: request.hostId.trim(),
    includeStopped: request.includeStopped ?? true,
    runtime: request.runtime ?? "docker",
  };
}

function browserPreviewContainers(
  request: Required<DockerContainerListRequest>,
): DockerContainerSummary[] {
  const containers = [
    previewContainer(request.hostId, {
      id: "c0ffee1234567890",
      image: "kerminal/api:latest",
      name: "api",
      ports: ["0.0.0.0:8080->80/tcp"],
      state: "running",
      status: "running",
      statusText: "Up 12 minutes",
    }),
    previewContainer(request.hostId, {
      id: "deadbeef98765432",
      image: "postgres:16",
      name: "postgres",
      ports: ["5432/tcp"],
      state: "exited",
      status: "exited",
      statusText: "Exited (0) 2 hours ago",
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
    hostId,
    id: input.id,
    image: input.image,
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
