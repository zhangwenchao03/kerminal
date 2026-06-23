import { Select } from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import {
  serialDataBitOptions,
  serialFlowOptions,
  serialParityOptions,
  serialStopBitOptions,
} from "./model";
import { FieldRow, inputClassName } from "./shared-ui";

export function TelnetPropertiesPanel({
  groupId,
  groupOptions,
  host,
  name,
  port,
  setGroupId,
  setHost,
  setName,
  setPort,
  setTelnetNote,
  telnetNote,
}: {
  groupId: string;
  groupOptions: Array<{ label: string; value: string }>;
  host: string;
  name: string;
  port: string;
  setGroupId: (value: string) => void;
  setHost: (value: string) => void;
  setName: (value: string) => void;
  setPort: (value: string) => void;
  setTelnetNote: (value: string) => void;
  telnetNote: string;
}) {
  return (
    <div className="grid gap-3">
      <FieldRow label="名称">
        <input
          aria-label="名称"
          autoFocus
          className={inputClassName}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="例如：lab-telnet"
          value={name}
        />
      </FieldRow>
      <FieldRow label="分组">
        <Select
          aria-label="分组"
          buttonClassName="h-10"
          onValueChange={setGroupId}
          options={groupOptions}
          value={groupId}
        />
      </FieldRow>
      <FieldRow label="主机">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_136px]">
          <input
            aria-label="主机"
            className={inputClassName}
            onChange={(event) => setHost(event.currentTarget.value)}
            placeholder="telnet.internal 或 192.168.1.10"
            value={host}
          />
          <input
            aria-label="端口"
            className={inputClassName}
            inputMode="numeric"
            onChange={(event) => setPort(event.currentTarget.value)}
            value={port}
          />
        </div>
      </FieldRow>
      <FieldRow label="备注">
        <textarea
          aria-label="备注"
          className={`${inputClassName} min-h-[128px] resize-none py-2`}
          onChange={(event) => setTelnetNote(event.currentTarget.value)}
          placeholder="可选。备注字段会在后续配置扩展中接入。"
          value={telnetNote}
        />
      </FieldRow>
    </div>
  );
}

export function SerialPropertiesPanel({
  groupId,
  groupOptions,
  name,
  serialNote,
  setGroupId,
  setName,
  setSerialNote,
}: {
  groupId: string;
  groupOptions: Array<{ label: string; value: string }>;
  name: string;
  serialNote: string;
  setGroupId: (value: string) => void;
  setName: (value: string) => void;
  setSerialNote: (value: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <FieldRow label="名称">
        <input
          aria-label="名称"
          autoFocus
          className={inputClassName}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="例如：console-serial"
          value={name}
        />
      </FieldRow>
      <FieldRow label="分组">
        <Select
          aria-label="分组"
          buttonClassName="h-10"
          onValueChange={setGroupId}
          options={groupOptions}
          value={groupId}
        />
      </FieldRow>
      <FieldRow label="备注">
        <textarea
          aria-label="备注"
          className={`${inputClassName} min-h-[180px] resize-none py-2`}
          onChange={(event) => setSerialNote(event.currentTarget.value)}
          placeholder="可选。记录设备用途、机柜位置或接线说明。"
          value={serialNote}
        />
      </FieldRow>
    </div>
  );
}

export function SerialOptionsPanel({
  serialBaud,
  serialDataBits,
  serialFlow,
  serialParity,
  serialPort,
  serialStopBits,
  setSerialBaud,
  setSerialDataBits,
  setSerialFlow,
  setSerialParity,
  setSerialPort,
  setSerialStopBits,
}: {
  serialBaud: string;
  serialDataBits: string;
  serialFlow: string;
  serialParity: string;
  serialPort: string;
  serialStopBits: string;
  setSerialBaud: (value: string) => void;
  setSerialDataBits: (value: string) => void;
  setSerialFlow: (value: string) => void;
  setSerialParity: (value: string) => void;
  setSerialPort: (value: string) => void;
  setSerialStopBits: (value: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <FieldRow label="串口">
        <input
          aria-label="串口"
          className={inputClassName}
          onChange={(event) => setSerialPort(event.currentTarget.value)}
          placeholder="例如：COM3 或 /dev/ttyUSB0"
          value={serialPort}
        />
      </FieldRow>
      <FieldRow label="波特率">
        <input
          aria-label="波特率"
          className={inputClassName}
          inputMode="numeric"
          onChange={(event) => setSerialBaud(event.currentTarget.value)}
          placeholder="9600"
          value={serialBaud}
        />
      </FieldRow>
      <FieldRow label="数据位">
        <Select
          aria-label="数据位"
          buttonClassName="h-10"
          onValueChange={setSerialDataBits}
          options={serialDataBitOptions}
          value={serialDataBits}
        />
      </FieldRow>
      <FieldRow label="停止位">
        <Select
          aria-label="停止位"
          buttonClassName="h-10"
          onValueChange={setSerialStopBits}
          options={serialStopBitOptions}
          value={serialStopBits}
        />
      </FieldRow>
      <FieldRow label="校验">
        <Select
          aria-label="校验"
          buttonClassName="h-10"
          onValueChange={setSerialParity}
          options={serialParityOptions}
          value={serialParity}
        />
      </FieldRow>
      <FieldRow label="流控">
        <Select
          aria-label="流控"
          buttonClassName="h-10"
          onValueChange={setSerialFlow}
          options={serialFlowOptions}
          value={serialFlow}
        />
      </FieldRow>
    </div>
  );
}

export function RdpPropertiesPanel({
  host,
  name,
  port,
  rdpNote,
  rdpPassword,
  rdpUsername,
  setHost,
  setName,
  setPort,
  setRdpNote,
  setRdpPassword,
  setRdpUsername,
}: {
  host: string;
  name: string;
  port: string;
  rdpNote: string;
  rdpPassword: string;
  rdpUsername: string;
  setHost: (value: string) => void;
  setName: (value: string) => void;
  setPort: (value: string) => void;
  setRdpNote: (value: string) => void;
  setRdpPassword: (value: string) => void;
  setRdpUsername: (value: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <FieldRow label="名称">
        <input
          aria-label="名称"
          autoFocus
          className={inputClassName}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="例如：office-rdp"
          value={name}
        />
      </FieldRow>
      <FieldRow label="主机">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_136px]">
          <input
            aria-label="主机"
            className={inputClassName}
            onChange={(event) => setHost(event.currentTarget.value)}
            placeholder="rdp.internal 或 workstation.example.com"
            value={host}
          />
          <input
            aria-label="端口"
            className={inputClassName}
            inputMode="numeric"
            onChange={(event) => setPort(event.currentTarget.value)}
            value={port}
          />
        </div>
      </FieldRow>
      <FieldRow label="用户名">
        <input
          aria-label="用户名"
          className={inputClassName}
          onChange={(event) => setRdpUsername(event.currentTarget.value)}
          placeholder="例如：administrator"
          value={rdpUsername}
        />
      </FieldRow>
      <FieldRow label="密码">
        <input
          aria-label="密码"
          className={inputClassName}
          onChange={(event) => setRdpPassword(event.currentTarget.value)}
          placeholder="可选；确认后随主机配置保存"
          type="password"
          value={rdpPassword}
        />
      </FieldRow>
      <FieldRow label="备注">
        <textarea
          aria-label="备注"
          className={`${inputClassName} min-h-[128px] resize-none py-2`}
          onChange={(event) => setRdpNote(event.currentTarget.value)}
          placeholder="可选。备注字段会在后续配置扩展中接入。"
          value={rdpNote}
        />
      </FieldRow>
    </div>
  );
}

export function RdpDisplayPanel({
  rdpFullscreen,
  rdpHeight,
  rdpWidth,
  setRdpFullscreen,
  setRdpHeight,
  setRdpWidth,
}: {
  rdpFullscreen: boolean;
  rdpHeight: string;
  rdpWidth: string;
  setRdpFullscreen: (value: boolean) => void;
  setRdpHeight: (value: string) => void;
  setRdpWidth: (value: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <FieldRow label="模式">
        <div className="kerminal-field-surface flex h-10 items-center justify-between gap-3 rounded-xl border px-3 text-sm text-zinc-600 dark:text-zinc-300">
          <span>全屏</span>
          <Switch
            aria-label="全屏"
            checked={rdpFullscreen}
            onCheckedChange={setRdpFullscreen}
          />
        </div>
      </FieldRow>
      <FieldRow label="分辨率">
        <div className="grid gap-3 md:grid-cols-2">
          <input
            aria-label="RDP 宽度"
            className={inputClassName}
            disabled={rdpFullscreen}
            inputMode="numeric"
            onChange={(event) => setRdpWidth(event.currentTarget.value)}
            placeholder="宽度"
            value={rdpWidth}
          />
          <input
            aria-label="RDP 高度"
            className={inputClassName}
            disabled={rdpFullscreen}
            inputMode="numeric"
            onChange={(event) => setRdpHeight(event.currentTarget.value)}
            placeholder="高度"
            value={rdpHeight}
          />
        </div>
      </FieldRow>
    </div>
  );
}
