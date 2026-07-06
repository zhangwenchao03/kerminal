import { describe, expect, it } from "vitest";
import {
  buildWorkspaceFileTabKey,
  directoryForWorkspaceFilePath,
  normalizeWorkspaceFilePath,
  titleForWorkspaceFilePath,
} from "../../../../src/features/workspace/workspaceFileTabModel";

describe("workspaceFileTabModel", () => {
  it("normalizes remote file paths for stable tab identity", () => {
    expect(normalizeWorkspaceFilePath(" /etc/nginx//nginx.conf ")).toBe(
      "/etc/nginx/nginx.conf",
    );
    expect(normalizeWorkspaceFilePath("C:\\Users\\kong\\app.yaml")).toBe(
      "C:/Users/kong/app.yaml",
    );
    expect(normalizeWorkspaceFilePath("")).toBe("/");
  });

  it("builds distinct keys per target and normalized path", () => {
    expect(
      buildWorkspaceFileTabKey({
        access: "readonly",
        path: "/etc//app.yaml",
        source: "sftp",
        target: { hostId: "host-a", kind: "ssh" },
      }),
    ).toBe("ssh:host-a|readonly|sftp|/etc/app.yaml");

    expect(
      buildWorkspaceFileTabKey({
        access: "readonly",
        path: "/etc/app.yaml",
        source: "container",
        target: {
          containerId: "c1",
          hostId: "host-a",
          kind: "dockerContainer",
          runtime: "docker",
        },
      }),
    ).toBe("docker:host-a:c1:docker|readonly|container|/etc/app.yaml");
  });

  it("derives readable tab titles from paths", () => {
    expect(titleForWorkspaceFilePath("/opt/app/docker-compose.yml")).toBe(
      "docker-compose.yml",
    );
    expect(titleForWorkspaceFilePath("/")).toBe("/");
  });

  it("derives a containing directory for reveal actions", () => {
    expect(directoryForWorkspaceFilePath("/etc/nginx/nginx.conf")).toBe(
      "/etc/nginx",
    );
    expect(directoryForWorkspaceFilePath("/.env")).toBe("/");
    expect(directoryForWorkspaceFilePath("C:\\Users\\kong\\app.yaml")).toBe(
      "C:/Users/kong",
    );
  });
});
