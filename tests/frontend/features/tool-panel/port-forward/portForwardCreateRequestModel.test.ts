import { describe, expect, it } from "vitest";
import {
  buildPortForwardCreateRequest,
  metadataFromCreateRequest,
} from "../../../../../src/features/tool-panel/port-forward/portForwardCreateRequestModel";

const baseInput = {
  hostId: "prod-api",
  hostTargetHost: "127.0.0.1",
  hostTargetPort: "5432",
  localBindHost: "127.0.0.1",
  localListenPort: "15432",
  localProxyHost: "127.0.0.1",
  localProxyPort: "18081",
  localSocksPort: "1080",
  localTargetHost: "127.0.0.1",
  localTargetPort: "3000",
  name: "  Postgres  ",
  proxyProtocol: "http",
  remoteBindHost: "127.0.0.1",
  remoteBindMode: "loopback",
  remoteListenPort: "18080",
  scenario: "hostService",
  socksMode: "localDynamic",
} as const;

describe("portForwardCreateRequestModel", () => {
  it("builds local forwarding requests for host services", () => {
    const request = buildPortForwardCreateRequest(baseInput);

    expect(request).toEqual({
      value: expect.objectContaining({
        bindHost: "127.0.0.1",
        hostId: "prod-api",
        kind: "local",
        localBindHost: "127.0.0.1",
        name: "Postgres",
        sourcePort: 15432,
        targetHost: "127.0.0.1",
        targetPort: 5432,
      }),
    });
  });

  it("builds network assist metadata from the create request", () => {
    const request = buildPortForwardCreateRequest({
      ...baseInput,
      name: "network",
      remoteBindHost: "0.0.0.0",
      remoteBindMode: "all",
      scenario: "hostNetwork",
    });

    expect(request).toEqual({
      value: expect.objectContaining({
        origin: "networkAssist",
        proxyProtocol: "http",
        proxyUrl: "http://127.0.0.1:18080",
        purpose: "hostNetworkAssist",
        remoteAccessScope: "allInterfaces",
      }),
    });
    if ("error" in request) {
      throw new Error(request.error);
    }
    expect(metadataFromCreateRequest(request.value)).toEqual(
      expect.objectContaining({
        origin: "networkAssist",
        proxyProtocol: "http",
        proxyUrl: "http://127.0.0.1:18080",
        purpose: "hostNetworkAssist",
        remoteAccessScope: "allInterfaces",
      }),
    );
  });

  it("returns field-specific validation errors", () => {
    expect(
      buildPortForwardCreateRequest({
        ...baseInput,
        localListenPort: "0",
      }),
    ).toEqual({ error: "本机监听端口必须是 1-65535 的整数。" });
  });
});
