import { Select } from "../../../components/ui/select";
import type { RemoteHostAuthType } from "../../../lib/remoteHostApi";
import { authOptions } from "./model";
import { FieldRow, GroupSelectRow, inputClassName } from "./shared-ui";

export function SshPropertiesPanel({
  authType,
  credentialRef,
  credentialSecret,
  groupId,
  groupOptions,
  host,
  name,
  onCreateGroupClick,
  port,
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
  groupId: string;
  groupOptions: Array<{ label: string; value: string }>;
  host: string;
  name: string;
  onCreateGroupClick?: () => void;
  port: string;
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
        <GroupSelectRow
          groupId={groupId}
          groupOptions={groupOptions}
          onCreateGroupClick={onCreateGroupClick}
          setGroupId={setGroupId}
        />
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
            placeholder="root"
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
              多个标签可用逗号或空格分隔。
            </p>
          </div>
        </FieldRow>
      </div>
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
          {authType === "password" ? (
            <div className="grid gap-2">
              <input
                aria-label="SSH 密码"
                autoComplete="off"
                className={inputClassName}
                onChange={(event) =>
                  setCredentialSecret(event.currentTarget.value)
                }
                placeholder="输入 SSH 密码"
                type="text"
                value={credentialSecret}
              />
              <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                密码明文保存，编辑时显示。
              </p>
            </div>
          ) : (
            <div className="grid gap-2">
              <input
                aria-label="私钥路径"
                className={inputClassName}
                onChange={(event) => setCredentialRef(event.currentTarget.value)}
                placeholder="~/.ssh/id_ed25519"
                value={credentialRef}
              />
              <textarea
                aria-label="私钥内容"
                className={`${inputClassName} min-h-[140px] resize-none py-2 font-mono text-xs`}
                onChange={(event) =>
                  setCredentialSecret(event.currentTarget.value)
                }
                placeholder="也可粘贴 OpenSSH 私钥内容"
                spellCheck={false}
                value={credentialSecret}
              />
              <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                私钥路径和内容二选一；内容明文保存。
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
