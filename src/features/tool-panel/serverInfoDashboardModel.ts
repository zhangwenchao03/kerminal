import type { NetworkInterfaceTraffic } from "./serverInfoMetricsModel";

export type NetworkInterfaceRole =
  | "bridge"
  | "loopback"
  | "physical"
  | "tunnel"
  | "virtual";

export type NetworkInterfaceFilter = "all" | "primary" | "virtual";

export interface ClassifiedNetworkInterface extends NetworkInterfaceTraffic {
  role: NetworkInterfaceRole;
}

/**
 * 根据 Linux 常见接口命名识别角色；未知命名默认按物理接口处理，
 * 避免定制网卡被错误隐藏。
 */
export function classifyNetworkInterface(
  networkInterface: NetworkInterfaceTraffic,
): ClassifiedNetworkInterface {
  const name = networkInterface.name.toLowerCase();
  let role: NetworkInterfaceRole = "physical";
  if (name === "lo") {
    role = "loopback";
  } else if (/^(br-|bridge|docker|virbr)/.test(name)) {
    role = "bridge";
  } else if (/^(tun|tap|tailscale|wg|zt)/.test(name)) {
    role = "tunnel";
  } else if (/^(veth|cni|flannel|kube-ipvs|dummy)/.test(name)) {
    role = "virtual";
  }
  return { ...networkInterface, role };
}

export function classifiedNetworkInterfaces(
  interfaces: NetworkInterfaceTraffic[],
) {
  return interfaces.map(classifyNetworkInterface);
}

export function filterNetworkInterfaces(
  interfaces: NetworkInterfaceTraffic[],
  filter: NetworkInterfaceFilter,
) {
  const classified = classifiedNetworkInterfaces(interfaces);
  if (filter === "all") {
    return classified;
  }
  if (filter === "virtual") {
    return classified.filter((item) =>
      ["bridge", "tunnel", "virtual"].includes(item.role),
    );
  }

  const physical = classified.filter((item) => item.role === "physical");
  if (physical.length > 0) {
    return physical;
  }
  return classified.filter((item) => item.role !== "loopback").slice(0, 1);
}

export function primaryNetworkTraffic(
  interfaces: NetworkInterfaceTraffic[],
) {
  const primary = filterNetworkInterfaces(interfaces, "primary");
  return {
    interfaces: primary,
    rxBytesPerSecond: sumRates(
      primary.map((item) => item.rxBytesPerSecond),
    ),
    txBytesPerSecond: sumRates(
      primary.map((item) => item.txBytesPerSecond),
    ),
  };
}

export function networkInterfaceRoleLabel(role: NetworkInterfaceRole) {
  switch (role) {
    case "bridge":
      return "网桥";
    case "loopback":
      return "回环";
    case "tunnel":
      return "隧道";
    case "virtual":
      return "虚拟";
    default:
      return "主要";
  }
}

function sumRates(values: Array<number | undefined>) {
  const known = values.filter(
    (value): value is number => value !== undefined && Number.isFinite(value),
  );
  return known.length > 0
    ? known.reduce((total, value) => total + value, 0)
    : undefined;
}
