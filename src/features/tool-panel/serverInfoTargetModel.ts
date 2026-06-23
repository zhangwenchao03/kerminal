import { targetStableId, type RemoteTargetRef } from "../../lib/targetModel";
import type { Machine } from "../workspace/types";

export type ServerInfoTargetRef =
  | Extract<RemoteTargetRef, { kind: "ssh" }>
  | Extract<RemoteTargetRef, { kind: "dockerContainer" }>;

export interface ServerInfoTargetContext {
  badgeText?: string;
  cacheKey: string;
  hostId: string;
  refreshAriaLabel: string;
  subtitle: string;
  target: ServerInfoTargetRef;
  title: string;
}

export function serverInfoTargetContext(
  selectedMachine?: Machine,
): ServerInfoTargetContext | undefined {
  if (!selectedMachine) {
    return undefined;
  }
  if (selectedMachine.kind === "ssh") {
    const target: ServerInfoTargetRef =
      selectedMachine.target?.kind === "ssh"
        ? selectedMachine.target
        : { hostId: selectedMachine.id, kind: "ssh" };
    const endpoint = selectedMachine.host
      ? `${selectedMachine.username ? `${selectedMachine.username}@` : ""}${selectedMachine.host}${selectedMachine.port ? `:${selectedMachine.port}` : ""}`
      : undefined;
    return {
      ...(selectedMachine.production ? { badgeText: "生产主机" } : {}),
      cacheKey: targetStableId(target),
      hostId: target.hostId,
      refreshAriaLabel: "刷新服务器信息",
      subtitle: endpoint ?? "SSH 主机",
      target,
      title: "远程服务器",
    };
  }
  if (selectedMachine.kind === "dockerContainer") {
    const target: ServerInfoTargetRef | undefined =
      selectedMachine.target?.kind === "dockerContainer"
        ? selectedMachine.target
        : selectedMachine.parentMachineId && selectedMachine.containerId
          ? {
              containerId: selectedMachine.containerId,
              ...(selectedMachine.containerName
                ? { containerName: selectedMachine.containerName }
                : {}),
              hostId: selectedMachine.parentMachineId,
              kind: "dockerContainer",
              runtime: selectedMachine.runtime ?? "docker",
              ...(selectedMachine.user ? { user: selectedMachine.user } : {}),
              ...(selectedMachine.workdir
                ? { workdir: selectedMachine.workdir }
                : {}),
            }
          : undefined;
    if (!target || target.kind !== "dockerContainer") {
      return undefined;
    }
    const runtime = target.runtime ?? selectedMachine.runtime ?? "docker";
    const containerName =
      target.containerName ??
      selectedMachine.containerName ??
      selectedMachine.name ??
      target.containerId.slice(0, 12);
    const hostLabel = selectedMachine.host
      ? `${selectedMachine.username ? `${selectedMachine.username}@` : ""}${selectedMachine.host}`
      : target.hostId;
    return {
      ...(selectedMachine.production ? { badgeText: "生产容器" } : {}),
      cacheKey: targetStableId(target),
      hostId: target.hostId,
      refreshAriaLabel: "刷新容器系统信息",
      subtitle: `${containerName} · ${runtime} @ ${hostLabel}`,
      target,
      title: "容器系统",
    };
  }
  return undefined;
}
