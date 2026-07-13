import { useEffect, useState } from "react";
import type {
  PortForwardProxyProtocol,
  PortForwardSummary,
} from "../../../lib/portForwardApi";
import type {
  BindAddressMode,
  PortForwardScenario,
  SocksAdvancedMode,
} from "./portForwardWorkbenchModel";

/**
 * 管理端口转发表单草稿；主机变化时丢弃旧主机参数，避免对话框草稿跨目标复用。
 */
export function usePortForwardForm(hostId: string | undefined) {
  const [name, setName] = useState("");
  const [scenario, setScenario] = useState<PortForwardScenario>("hostService");
  const [localBindMode, setLocalBindMode] =
    useState<BindAddressMode>("loopback");
  const [localCustomBindHost, setLocalCustomBindHost] = useState("127.0.0.1");
  const [remoteBindMode, setRemoteBindMode] =
    useState<BindAddressMode>("loopback");
  const [remoteCustomBindHost, setRemoteCustomBindHost] = useState("127.0.0.1");
  const [localListenPort, setLocalListenPort] = useState("15432");
  const [hostTargetHost, setHostTargetHost] = useState("127.0.0.1");
  const [hostTargetPort, setHostTargetPort] = useState("5432");
  const [remoteListenPort, setRemoteListenPort] = useState("18080");
  const [localTargetHost, setLocalTargetHost] = useState("127.0.0.1");
  const [localTargetPort, setLocalTargetPort] = useState("3000");
  const [localProxyHost, setLocalProxyHost] = useState("127.0.0.1");
  const [localProxyPort, setLocalProxyPort] = useState("18081");
  const [localSocksPort, setLocalSocksPort] = useState("1080");
  const [proxyProtocol, setProxyProtocol] =
    useState<PortForwardProxyProtocol>("http");
  const [socksMode, setSocksMode] = useState<SocksAdvancedMode>("localDynamic");

  useEffect(() => {
    setName("");
    setScenario("hostService");
    setLocalBindMode("loopback");
    setLocalCustomBindHost("127.0.0.1");
    setRemoteBindMode("loopback");
    setRemoteCustomBindHost("127.0.0.1");
    setLocalListenPort("15432");
    setHostTargetHost("127.0.0.1");
    setHostTargetPort("5432");
    setRemoteListenPort("18080");
    setLocalTargetHost("127.0.0.1");
    setLocalTargetPort("3000");
    setLocalProxyHost("127.0.0.1");
    setLocalProxyPort("18081");
    setLocalSocksPort("1080");
    setProxyProtocol("http");
    setSocksMode("localDynamic");
  }, [hostId]);

  const applySession = (session: PortForwardSummary) => {
    setName(session.name);
    if (session.kind === "local") {
      setScenario("hostService");
      setLocalCustomBindHost(session.localBindHost ?? session.bindHost);
      setLocalBindMode(
        bindModeFromHost(session.localBindHost ?? session.bindHost),
      );
      setLocalListenPort(String(session.sourcePort));
      setHostTargetHost(
        session.targetHost ?? session.remoteEndpoint?.host ?? "127.0.0.1",
      );
      setHostTargetPort(
        String(session.targetPort ?? session.remoteEndpoint?.port ?? 80),
      );
      return;
    }
    if (session.kind === "dynamic") {
      setScenario("socksAdvanced");
      setSocksMode("localDynamic");
      setLocalCustomBindHost(session.localBindHost ?? session.bindHost);
      setLocalBindMode(
        bindModeFromHost(session.localBindHost ?? session.bindHost),
      );
      setLocalSocksPort(String(session.sourcePort));
      return;
    }
    if (session.purpose === "hostNetworkAssist") {
      if (session.proxyProtocol === "socks5" && !session.targetHost) {
        setScenario("socksAdvanced");
        setSocksMode("remoteDynamic");
      } else {
        setScenario("hostNetwork");
      }
      setProxyProtocol(session.proxyProtocol ?? "http");
      setRemoteCustomBindHost(session.remoteBindHost ?? session.bindHost);
      setRemoteBindMode(
        bindModeFromHost(session.remoteBindHost ?? session.bindHost),
      );
      setRemoteListenPort(String(session.sourcePort));
      setLocalProxyHost(
        session.localEndpoint?.host ?? session.targetHost ?? "127.0.0.1",
      );
      setLocalProxyPort(
        String(session.localEndpoint?.port ?? session.targetPort ?? 18081),
      );
      return;
    }
    setScenario("localService");
    setRemoteCustomBindHost(session.remoteBindHost ?? session.bindHost);
    setRemoteBindMode(
      bindModeFromHost(session.remoteBindHost ?? session.bindHost),
    );
    setRemoteListenPort(String(session.sourcePort));
    setLocalTargetHost(
      session.targetHost ?? session.localEndpoint?.host ?? "127.0.0.1",
    );
    setLocalTargetPort(
      String(session.targetPort ?? session.localEndpoint?.port ?? 3000),
    );
  };

  return {
    applySession,
    hostTargetHost,
    hostTargetPort,
    localBindMode,
    localCustomBindHost,
    localListenPort,
    localProxyHost,
    localProxyPort,
    localSocksPort,
    localTargetHost,
    localTargetPort,
    name,
    proxyProtocol,
    remoteBindMode,
    remoteCustomBindHost,
    remoteListenPort,
    scenario,
    setHostTargetHost,
    setHostTargetPort,
    setLocalBindMode,
    setLocalCustomBindHost,
    setLocalListenPort,
    setLocalProxyHost,
    setLocalProxyPort,
    setLocalSocksPort,
    setLocalTargetHost,
    setLocalTargetPort,
    setName,
    setProxyProtocol,
    setRemoteBindMode,
    setRemoteCustomBindHost,
    setRemoteListenPort,
    setScenario,
    setSocksMode,
    socksMode,
  };
}

function bindModeFromHost(host: string | undefined): BindAddressMode {
  const value = host?.trim();
  if (
    !value ||
    value === "127.0.0.1" ||
    value === "localhost" ||
    value === "::1"
  ) {
    return "loopback";
  }
  if (value === "0.0.0.0" || value === "::") {
    return "all";
  }
  return "custom";
}
