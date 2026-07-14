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
  localSocksPort: "1080",
  localTargetHost: "127.0.0.1",
  localTargetPort: "3000",
  name: "  Postgres  ",
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

  it("builds remote SOCKS metadata from the create request", () => {
    const request = buildPortForwardCreateRequest({
      ...baseInput,
      name: "remote socks",
      remoteBindHost: "0.0.0.0",
      remoteBindMode: "all",
      scenario: "socksAdvanced",
      socksMode: "remoteDynamic",
    });

    expect(request).toEqual({
      value: expect.objectContaining({
        kind: "remoteDynamic",
        origin: "user",
        proxyProtocol: "socks5",
        proxyUrl: "socks5h://127.0.0.1:18080",
        remoteAccessScope: "allInterfaces",
      }),
    });
    if ("error" in request) {
      throw new Error(request.error);
    }
    expect(metadataFromCreateRequest(request.value)).toEqual(
      expect.objectContaining({
        origin: "user",
        proxyProtocol: "socks5",
        proxyUrl: "socks5h://127.0.0.1:18080",
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
