import { describe, expect, it } from "vitest";
import {
  dockerContainerTarget,
  dockerContainerTargetCapabilities,
} from "../../../../../src/lib/targetModel";
import {
  buildComposeProjectViews,
  composeProjectMatchesQuery,
  composeStandaloneContainerMatchesQuery,
  type ComposeProjectContainerSummary,
} from "../../../../../src/features/machine-sidebar/host-containers/composeProjectModel";

function container(
  input: Partial<ComposeProjectContainerSummary> &
    Pick<ComposeProjectContainerSummary, "id" | "name">,
): ComposeProjectContainerSummary {
  const { id, name, ...overrides } = input;
  const hostId = input.hostId ?? "host-lab";
  const runtime = input.runtime ?? "docker";
  const target = dockerContainerTarget({
    containerId: id,
    containerName: name,
    hostId,
    runtime,
  });

  return {
    ...overrides,
    capabilities: dockerContainerTargetCapabilities,
    hostId,
    id,
    image: input.image ?? "kerminal/api:latest",
    name,
    ports: input.ports ?? [],
    runtime,
    shortId: input.shortId ?? id.slice(0, 12),
    state: input.state ?? input.status ?? "running",
    status: input.status ?? "running",
    statusText: input.statusText ?? "Up 12 minutes",
    target,
  };
}

describe("composeProjectModel", () => {
  it("builds Docker Compose project views from typed compose metadata", () => {
    const view = buildComposeProjectViews([
      container({
        compose: {
          configFiles: ["compose.yaml", "compose.override.yaml"],
          project: "kerminal",
          service: "api",
          workingDir: "/srv/kerminal",
        },
        id: "api1111111111",
        name: "api",
        ports: ["0.0.0.0:8080->80/tcp"],
      }),
      container({
        compose: {
          configFiles: ["compose.yaml", "compose.override.yaml"],
          project: "kerminal",
          service: "worker",
          workingDir: "/srv/kerminal",
        },
        id: "worker111111",
        name: "worker",
        status: "exited",
        statusText: "Exited (0) 1 hour ago",
      }),
      container({
        id: "redis1111111",
        image: "redis:7",
        name: "redis",
        ports: ["6379/tcp"],
      }),
    ]);

    expect(view.totalCount).toBe(3);
    expect(view.runningCount).toBe(2);
    expect(view.stoppedCount).toBe(1);
    expect(view.projects).toHaveLength(1);
    expect(view.standaloneContainers.map((item) => item.name)).toEqual([
      "redis",
    ]);
    expect(view.projects[0]).toMatchObject({
      configPaths: [
        "/srv/kerminal/compose.yaml",
        "/srv/kerminal/compose.override.yaml",
      ],
      project: "kerminal",
      runningCount: 1,
      totalCount: 2,
      warnings: [],
      workingDir: "/srv/kerminal",
    });
    expect(view.projects[0]!.services.map((service) => service.service)).toEqual(
      ["api", "worker"],
    );
  });

  it("supports Docker labels and preserves multi-file config order", () => {
    const view = buildComposeProjectViews([
      container({
        id: "web111111111",
        labels: {
          "com.docker.compose.project": "label-shop",
          "com.docker.compose.project.config_files":
            "compose.yaml,compose.prod.yaml",
          "com.docker.compose.project.working_dir": "/opt/shop",
          "com.docker.compose.service": "web",
        },
        name: "web",
      }),
      container({
        labels: {
          "com.docker.compose.project": "label-shop",
          "com.docker.compose.service": "jobs",
        },
        id: "jobs11111111",
        name: "jobs",
        status: "dead",
        statusText: "Dead",
      }),
    ]);

    expect(view.errorCount).toBe(1);
    expect(view.projects[0]).toMatchObject({
      configFiles: ["compose.yaml", "compose.prod.yaml"],
      configPaths: ["/opt/shop/compose.yaml", "/opt/shop/compose.prod.yaml"],
      errorCount: 1,
      project: "label-shop",
      warningCount: 0,
    });
    expect(view.projects[0]!.services.map((service) => service.service)).toEqual(
      ["web", "jobs"],
    );
  });

  it("supports Podman Compose labels and warns when YAML paths are missing", () => {
    const view = buildComposeProjectViews([
      container({
        id: "podman-web111",
        labels: {
          "io.podman.compose.project": "toolbox",
          "io.podman.compose.service": "web",
        },
        name: "toolbox-web",
        runtime: "podman",
      }),
    ]);

    expect(view.projects[0]).toMatchObject({
      configPaths: [],
      project: "toolbox",
      runtime: "podman",
      runtimeFamily: "podman",
      warningCount: 1,
      warnings: ["未发现 Compose YAML 路径"],
    });
    expect(view.warningCount).toBe(1);
    expect(view.warnings).toEqual(["toolbox: 未发现 Compose YAML 路径"]);
  });

  it("searches project, service, container, image, port, and config paths", () => {
    const view = buildComposeProjectViews([
      container({
        compose: {
          configPaths: [
            "/srv/kerminal/compose.yaml",
            "/srv/kerminal/compose.override.yaml",
          ],
          project: "kerminal",
          service: "api",
          workingDir: "/srv/kerminal",
        },
        id: "api1111111111",
        image: "ghcr.io/kerminal/api:latest",
        name: "api",
        ports: ["0.0.0.0:8080->80/tcp"],
      }),
      container({
        id: "redis1111111",
        image: "redis:7",
        name: "cache",
        ports: ["6379/tcp"],
      }),
    ]);

    const project = view.projects[0]!;
    const standalone = view.standaloneContainers[0]!;

    expect(composeProjectMatchesQuery(project, "kerminal")).toBe(true);
    expect(composeProjectMatchesQuery(project, "api")).toBe(true);
    expect(composeProjectMatchesQuery(project, "ghcr.io/kerminal")).toBe(true);
    expect(composeProjectMatchesQuery(project, "8080")).toBe(true);
    expect(composeProjectMatchesQuery(project, "compose.override.yaml")).toBe(
      true,
    );
    expect(composeStandaloneContainerMatchesQuery(standalone, "6379")).toBe(
      true,
    );
    expect(composeProjectMatchesQuery(project, "redis")).toBe(false);
  });
});
