import type {
  PortForwardCreateRequest,
  PortForwardSummary,
} from "../../../lib/portForwardApi";
import {
  buildRemoteSocksCommand,
  buildProxyUrl,
  parsePort,
  type BindAddressMode,
  type PortForwardScenario,
  type SocksAdvancedMode,
} from "./portForwardWorkbenchModel";

export type PortForwardSessionMetadata = Pick<
  PortForwardSummary,
  | "commandPreview"
  | "localBindHost"
  | "localEndpoint"
  | "origin"
  | "proxyProtocol"
  | "proxyUrl"
  | "remoteAccessScope"
  | "remoteBindHost"
  | "remoteEndpoint"
>;

export interface BuildPortForwardCreateRequestInput {
  hostId: string;
  hostTargetHost: string;
  hostTargetPort: string;
  localBindHost: string;
  localListenPort: string;
  localSocksPort: string;
  localTargetHost: string;
  localTargetPort: string;
  name: string;
  remoteBindHost: string;
  remoteBindMode: BindAddressMode;
  remoteListenPort: string;
  scenario: PortForwardScenario;
  socksMode: SocksAdvancedMode;
}

export function buildPortForwardCreateRequest({
  hostId,
  hostTargetHost,
  hostTargetPort,
  localBindHost,
  localListenPort,
  localSocksPort,
  localTargetHost,
  localTargetPort,
  name,
  remoteBindHost,
  remoteBindMode,
  remoteListenPort,
  scenario,
  socksMode,
}: BuildPortForwardCreateRequestInput):
  | { value: PortForwardCreateRequest }
  | { error: string } {
  const trimmedName = name.trim() || undefined;

  if (scenario === "hostService") {
    const sourcePort = parsePort(localListenPort, "本机监听端口");
    const targetPort = parsePort(hostTargetPort, "主机目标端口");
    if (!sourcePort.ok) {
      return { error: sourcePort.error };
    }
    if (!targetPort.ok) {
      return { error: targetPort.error };
    }
    return {
      value: {
        bindHost: localBindHost,
        remoteEndpoint: {
          host: hostTargetHost.trim() || "127.0.0.1",
          label: "主机服务",
          port: targetPort.port,
          protocol: "tcp",
          side: "host",
        },
        hostId,
        kind: "local",
        localBindHost,
        localEndpoint: {
          host: localBindHost,
          label: "本机监听",
          port: sourcePort.port,
          protocol: "tcp",
          side: "local",
        },
        name: trimmedName,
        sourcePort: sourcePort.port,
        targetHost: hostTargetHost.trim() || "127.0.0.1",
        targetPort: targetPort.port,
      },
    };
  }

  if (scenario === "localService") {
    const sourcePort = parsePort(remoteListenPort, "主机监听端口");
    const targetPort = parsePort(localTargetPort, "本机目标端口");
    if (!sourcePort.ok) {
      return { error: sourcePort.error };
    }
    if (!targetPort.ok) {
      return { error: targetPort.error };
    }
    return {
      value: {
        bindHost: remoteBindHost,
        remoteEndpoint: {
          host: remoteBindHost,
          label: "主机监听",
          port: sourcePort.port,
          protocol: "tcp",
          side: "host",
        },
        hostId,
        kind: "remote",
        localEndpoint: {
          host: localTargetHost.trim() || "127.0.0.1",
          label: "本机服务",
          port: targetPort.port,
          protocol: "tcp",
          side: "local",
        },
        name: trimmedName,
        remoteBindHost,
        sourcePort: sourcePort.port,
        targetHost: localTargetHost.trim() || "127.0.0.1",
        targetPort: targetPort.port,
      },
    };
  }

  if (socksMode === "remoteDynamic") {
    const sourcePort = parsePort(remoteListenPort, "主机 SOCKS 端口");
    if (!sourcePort.ok) {
      return { error: sourcePort.error };
    }
    const proxyUrl = buildProxyUrl({
      bindHost: remoteBindHost,
      port: sourcePort.port,
    });
    return {
      value: {
        bindHost: remoteBindHost,
        commandPreview: buildRemoteSocksCommand({ proxyUrl }),
        remoteEndpoint: {
          host: remoteBindHost,
          label: "主机 SOCKS",
          port: sourcePort.port,
          protocol: "socks5",
          side: "host",
        },
        hostId,
        kind: "remoteDynamic",
        localEndpoint: {
          host: "OpenSSH remote dynamic",
          label: "远端动态 SOCKS",
          protocol: "socks5",
          side: "local",
        },
        name: trimmedName,
        origin: "user",
        proxyProtocol: "socks5",
        proxyUrl,
        remoteAccessScope:
          remoteBindMode === "all" ? "allInterfaces" : remoteBindMode,
        remoteBindHost,
        sourcePort: sourcePort.port,
      },
    };
  }

  const sourcePort = parsePort(localSocksPort, "本机 SOCKS 端口");
  if (!sourcePort.ok) {
    return { error: sourcePort.error };
  }
  return {
    value: {
      bindHost: localBindHost,
      remoteEndpoint: {
        host: "主机网络出口",
        label: "主机网络出口",
        protocol: "socks5",
        side: "host",
      },
      hostId,
      kind: "dynamic",
      localBindHost,
      localEndpoint: {
        host: localBindHost,
        label: "本机 SOCKS",
        port: sourcePort.port,
        protocol: "socks5",
        side: "local",
      },
      name: trimmedName,
      sourcePort: sourcePort.port,
    },
  };
}

export function metadataFromCreateRequest(
  request: PortForwardCreateRequest,
): PortForwardSessionMetadata {
  return {
    commandPreview: request.commandPreview,
    localBindHost: request.localBindHost,
    localEndpoint: request.localEndpoint,
    origin: request.origin,
    proxyProtocol: request.proxyProtocol,
    proxyUrl: request.proxyUrl,
    remoteAccessScope: request.remoteAccessScope,
    remoteBindHost: request.remoteBindHost,
    remoteEndpoint: request.remoteEndpoint,
  };
}
