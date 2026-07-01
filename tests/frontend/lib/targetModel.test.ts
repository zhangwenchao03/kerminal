import { describe, expect, it } from "vitest";
import {
  dockerContainerTarget,
  fileLocation,
  normalizeRemoteTargetRef,
  serialTarget,
  sshTarget,
  targetCapabilitiesForKind,
  targetHostId,
  targetStableId,
  telnetTarget,
} from "../../../src/lib/targetModel";

describe("targetModel", () => {
  it("builds stable ids for SSH and container targets", () => {
    const ssh = sshTarget(" host-lab ");
    const container = dockerContainerTarget({
      containerId: " abc123 ",
      containerName: " api ",
      hostId: " host-lab ",
      workdir: "srv/app/",
    });

    expect(targetStableId(ssh)).toBe("ssh:host-lab");
    expect(targetStableId(container)).toBe("docker:host-lab:abc123");
    expect(targetHostId(container)).toBe("host-lab");
    expect(container).toMatchObject({
      containerName: "api",
      workdir: "/srv/app",
    });
  });

  it("builds stable ids for Telnet and Serial targets", () => {
    const telnet = telnetTarget(" lab-host ");
    const serial = serialTarget(" console-port ");

    expect(targetStableId(telnet)).toBe("telnet:lab-host");
    expect(targetStableId(serial)).toBe("serial:console-port");
    expect(targetHostId(telnet)).toBe("lab-host");
    expect(targetHostId(serial)).toBe("console-port");
  });

  it("normalizes file locations without losing the target", () => {
    const target = sshTarget("host-lab");
    const location = fileLocation(target, "var//log/");

    expect(location).toEqual({
      path: "/var/log",
      target,
    });
  });

  it("normalizes unknown JSON into a discriminated target ref", () => {
    expect(
      normalizeRemoteTargetRef({
        containerId: "container-1",
        hostId: "host-lab",
        kind: "dockerContainer",
        runtime: "podman",
      }),
    ).toEqual({
      containerId: "container-1",
      hostId: "host-lab",
      kind: "dockerContainer",
      runtime: "podman",
    });
    expect(
      normalizeRemoteTargetRef({
        hostId: " lab-host ",
        kind: "telnet",
      }),
    ).toEqual({ hostId: "lab-host", kind: "telnet" });
    expect(
      normalizeRemoteTargetRef({
        hostId: " console-port ",
        kind: "serial",
      }),
    ).toEqual({ hostId: "console-port", kind: "serial" });
    expect(normalizeRemoteTargetRef({ hostId: "", kind: "ssh" })).toBeUndefined();
  });

  it("declares container file and terminal capabilities", () => {
    expect(targetCapabilitiesForKind("dockerContainer")).toMatchObject({
      download: true,
      exec: true,
      files: true,
      terminal: true,
      upload: true,
    });
    expect(targetCapabilitiesForKind("telnet")).toEqual({
      download: false,
      exec: false,
      files: false,
      ports: false,
      terminal: true,
      upload: false,
    });
    expect(targetCapabilitiesForKind("serial")).toEqual({
      download: false,
      exec: false,
      files: false,
      ports: false,
      terminal: true,
      upload: false,
    });
  });
});
