import {
  BindAddressControl,
  EndpointHeader,
  FieldInput,
  PreviewValue,
  SocksModeToggle,
} from "./PortForwardRouteEditor";
import { buildProxyUrl, buildRemoteSocksCommand } from "./portForwardWorkbenchModel";
import type { usePortForwardForm } from "./usePortForwardForm";

type PortForwardForm = ReturnType<typeof usePortForwardForm>;

/** 端点 presenter 只解释当前草稿，不执行创建、停止或自动注入命令。 */
export function PortForwardEndpointFields({ form, remoteBindHost, side }: {
  form: PortForwardForm;
  remoteBindHost: string;
  side: "host" | "local";
}) {
  const {
    hostTargetHost, hostTargetPort, localBindMode, localCustomBindHost,
    localListenPort, localSocksPort, localTargetHost, localTargetPort,
    remoteBindMode, remoteCustomBindHost, remoteListenPort, scenario,
    setHostTargetHost, setHostTargetPort, setLocalBindMode,
    setLocalCustomBindHost, setLocalListenPort, setLocalSocksPort,
    setLocalTargetHost, setLocalTargetPort, setRemoteBindMode,
    setRemoteCustomBindHost, setRemoteListenPort, setSocksMode, socksMode,
  } = form;

  if (side === "host") {
    if (scenario === "hostService") return <>
      <EndpointHeader detail="SSH 连接另一侧" title="主机目标服务" />
      <FieldInput id="forward-host-target-host" label="主机目标地址" onChange={setHostTargetHost} value={hostTargetHost} />
      <FieldInput id="forward-host-target-port" label="主机目标端口" onChange={setHostTargetPort} value={hostTargetPort} />
    </>;
    if (scenario === "localService") return <>
      <EndpointHeader detail="远端入口" title="主机监听" />
      <BindAddressControl customHost={remoteCustomBindHost} idPrefix="forward-remote-service-bind" label="主机监听范围" mode={remoteBindMode} onCustomHostChange={setRemoteCustomBindHost} onModeChange={setRemoteBindMode} />
      <FieldInput id="forward-remote-service-port" label="主机监听端口" onChange={setRemoteListenPort} value={remoteListenPort} />
    </>;
    if (socksMode === "remoteDynamic") return <>
      <EndpointHeader detail="远端 SOCKS 代理" title="主机 SOCKS" />
      <BindAddressControl customHost={remoteCustomBindHost} idPrefix="forward-remote-socks-bind" label="主机监听范围" mode={remoteBindMode} onCustomHostChange={setRemoteCustomBindHost} onModeChange={setRemoteBindMode} />
      <FieldInput id="forward-remote-socks-port" label="主机 SOCKS 端口" onChange={setRemoteListenPort} value={remoteListenPort} />
    </>;
    return <><EndpointHeader detail="经由 SSH 主机" title="主机网络出口" /><PreviewValue label="出口" value="主机网络" /></>;
  }

  if (scenario === "hostService") return <>
    <EndpointHeader detail="本机入口" title="本机监听" />
    <BindAddressControl customHost={localCustomBindHost} idPrefix="forward-local-bind" label="本机监听范围" mode={localBindMode} onCustomHostChange={setLocalCustomBindHost} onModeChange={setLocalBindMode} />
    <FieldInput id="forward-local-listen-port" label="本机监听端口" onChange={setLocalListenPort} value={localListenPort} />
  </>;
  if (scenario === "localService") return <>
    <EndpointHeader detail="本机真实服务" title="本机服务" />
    <FieldInput id="forward-local-target-host" label="本机目标地址" onChange={setLocalTargetHost} value={localTargetHost} />
    <FieldInput id="forward-local-target-port" label="本机目标端口" onChange={setLocalTargetPort} value={localTargetPort} />
  </>;
  return <>
    <EndpointHeader detail="本机应用配置 SOCKS" title="本机 SOCKS" />
    <SocksModeToggle onChange={setSocksMode} value={socksMode} />
    {socksMode === "localDynamic" ? <>
      <BindAddressControl customHost={localCustomBindHost} idPrefix="forward-local-socks-bind" label="本机监听范围" mode={localBindMode} onCustomHostChange={setLocalCustomBindHost} onModeChange={setLocalBindMode} />
      <FieldInput id="forward-local-socks-port" label="本机 SOCKS 端口" onChange={setLocalSocksPort} value={localSocksPort} />
    </> : <PreviewValue label="远端注入" value={buildRemoteSocksCommand({ proxyUrl: buildProxyUrl({ bindHost: remoteBindHost, port: Number(remoteListenPort) || 0 }) }).split("\n")[0]} />}
  </>;
}
