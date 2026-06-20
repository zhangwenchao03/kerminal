import { KeyRound } from "lucide-react";
import { Select } from "../../../components/ui/select";
import type {
  RemoteHost,
  RemoteHostAuthType,
} from "../../../lib/remoteHostApi";
import { authOptions } from "./model";
import { FieldRow, inputClassName } from "./shared-ui";

export function SshPropertiesPanel({
  authType,
  credentialRef,
  credentialSecret,
  editingHost,
  groupId,
  groupOptions,
  host,
  name,
  port,
  selectedProtocolLabel,
  setAuthType,
  setCredentialRef,
  setCredentialSecret,
  setGroupId,
  setHost,
  setName,
  setPort,
  setTags,
  setUsername,
  tags,
  username,
}: {
  authType: RemoteHostAuthType;
  credentialRef: string;
  credentialSecret: string;
  editingHost?: RemoteHost;
  groupId: string;
  groupOptions: Array<{ label: string; value: string }>;
  host: string;
  name: string;
  port: string;
  selectedProtocolLabel: string;
  setAuthType: (value: RemoteHostAuthType) => void;
  setCredentialRef: (value: string) => void;
  setCredentialSecret: (value: string) => void;
  setGroupId: (value: string) => void;
  setHost: (value: string) => void;
  setName: (value: string) => void;
  setPort: (value: string) => void;
  setTags: (value: string) => void;
  setUsername: (value: string) => void;
  tags: string;
  username: string;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3">
        <FieldRow label="名称">
          <input
            aria-label="名称"
            autoFocus
            className={inputClassName}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="例如：ubuntu-dev"
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
              placeholder="dev.internal 或 server.example.com"
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
            onChange={(event) => setUsername(event.currentTarget.value)}
            placeholder="ubuntu"
            value={username}
          />
        </FieldRow>
        <FieldRow label="认证">
          <SshAuthFields
            authType={authType}
            credentialRef={credentialRef}
            credentialSecret={credentialSecret}
            setAuthType={setAuthType}
            setCredentialRef={setCredentialRef}
            setCredentialSecret={setCredentialSecret}
          />
        </FieldRow>
        <FieldRow label="标签">
          <div className="space-y-1">
            <input
              aria-label="标签"
              className={inputClassName}
              onChange={(event) => setTags(event.currentTarget.value)}
              placeholder="例如：dev, ubuntu, staging"
              value={tags}
            />
            <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              多个标签可用逗号、空格或中文逗号分隔，例如：dev ubuntu，staging。
            </p>
          </div>
        </FieldRow>
      </div>
      {editingHost ? null : (
        <div className="rounded-xl bg-black/[0.03] px-3 py-2 text-xs text-zinc-500 dark:bg-white/6 dark:text-zinc-400">
          {selectedProtocolLabel} 保存后会出现在左侧对应区域里。
        </div>
      )}
    </div>
  );
}

export function SshAuthFields({
  authType,
  credentialRef,
  credentialSecret,
  setAuthType,
  setCredentialRef,
  setCredentialSecret,
}: {
  authType: RemoteHostAuthType;
  credentialRef: string;
  credentialSecret: string;
  setAuthType: (value: RemoteHostAuthType) => void;
  setCredentialRef: (value: string) => void;
  setCredentialSecret: (value: string) => void;
}) {
  const selectedOption = authOptions.find((option) => option.value === authType);
  const credentialRefLabel =
    authType === "key" ? "私钥路径或引用" : "已有凭据引用";
  const credentialRefPlaceholder =
    authType === "key"
      ? "~/.ssh/id_ed25519 或 credential:ssh/dev"
      : "credential:ssh/dev/password";

  return (
    <div className="grid gap-3">
      <Select
        aria-label="认证方式"
        buttonClassName="h-10"
        onValueChange={(value) => {
          const nextAuthType = value as RemoteHostAuthType;
          if (nextAuthType === authType) {
            return;
          }
          setAuthType(nextAuthType);
          setCredentialRef("");
          setCredentialSecret("");
        }}
        options={authOptions.map((option) => ({
          description: option.helper,
          label: option.label,
          value: option.value,
        }))}
        value={authType}
      />
      {authType === "agent" ? null : (
        <>
          <input
            aria-label={credentialRefLabel}
            className={inputClassName}
            onChange={(event) => setCredentialRef(event.currentTarget.value)}
            placeholder={credentialRefPlaceholder}
            value={credentialRef}
          />
          {authType === "password" ? (
            <input
              aria-label="SSH 密码"
              autoComplete="new-password"
              className={inputClassName}
              onChange={(event) => setCredentialSecret(event.currentTarget.value)}
              placeholder={
                credentialRef ? "留空则继续使用上面的凭据引用" : "保存到系统凭据仓库"
              }
              type="password"
              value={credentialSecret}
            />
          ) : (
            <textarea
              aria-label="私钥内容"
              className={`${inputClassName} min-h-[140px] resize-none py-2 font-mono text-xs`}
              onChange={(event) => setCredentialSecret(event.currentTarget.value)}
              placeholder={
                credentialRef
                  ? "可选；留空则使用上面的路径或凭据引用"
                  : "可粘贴 OpenSSH 私钥内容，保存到系统凭据仓库"
              }
              spellCheck={false}
              value={credentialSecret}
            />
          )}
        </>
      )}
      <div className="rounded-2xl border border-black/8 bg-white/72 p-4 dark:border-white/8 dark:bg-white/6">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 h-4 w-4 text-sky-500 dark:text-sky-300" />
          <div className="min-w-0 flex-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            <span className="font-medium text-zinc-700 dark:text-zinc-200">
              {selectedOption?.helper}
            </span>
            <span className="ml-1">
              密码或私钥内容只保存到系统凭据仓库，主机配置仅保存引用。
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
