import { describe, expect, it } from "vitest";
import {
  classifyNetworkInterface,
  filterNetworkInterfaces,
  primaryNetworkTraffic,
} from "../../../../src/features/tool-panel/serverInfoDashboardModel";
import type { NetworkInterfaceTraffic } from "../../../../src/features/tool-panel/serverInfoMetricsModel";

const item = (
  name: string,
  rxBytesPerSecond?: number,
  txBytesPerSecond?: number,
): NetworkInterfaceTraffic => ({
  name,
  rxBytesPerSecond,
  txBytesPerSecond,
});

describe("serverInfoDashboardModel", () => {
  it("classifies common Linux interface roles", () => {
    expect(classifyNetworkInterface(item("lo")).role).toBe("loopback");
    expect(classifyNetworkInterface(item("eth0")).role).toBe("physical");
    expect(classifyNetworkInterface(item("docker0")).role).toBe("bridge");
    expect(classifyNetworkInterface(item("veth1234")).role).toBe("virtual");
    expect(classifyNetworkInterface(item("tailscale0")).role).toBe("tunnel");
  });

  it("keeps overview traffic on physical interfaces to avoid double counting", () => {
    const traffic = primaryNetworkTraffic([
      item("eth0", 2_000, 1_000),
      item("docker0", 8_000, 4_000),
      item("veth1234", 8_000, 4_000),
      item("lo", 100, 100),
    ]);

    expect(traffic.interfaces.map((entry) => entry.name)).toEqual(["eth0"]);
    expect(traffic.rxBytesPerSecond).toBe(2_000);
    expect(traffic.txBytesPerSecond).toBe(1_000);
  });

  it("supports primary, virtual and all filters for large interface sets", () => {
    const interfaces = [
      item("eth0"),
      item("lo"),
      item("docker0"),
      ...Array.from({ length: 23 }, (_, index) => item(`veth${index}`)),
    ];

    expect(filterNetworkInterfaces(interfaces, "primary")).toHaveLength(1);
    expect(filterNetworkInterfaces(interfaces, "virtual")).toHaveLength(24);
    expect(filterNetworkInterfaces(interfaces, "all")).toHaveLength(26);
  });
});
