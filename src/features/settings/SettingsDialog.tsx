import { ModalShell } from "../../components/ui/modal-shell";
import {
  SettingsToolContent,
  type SettingsSaveState,
  type SettingsSectionId,
} from "./SettingsToolContent";
import type { AppSettings } from "./settingsModel";

interface SettingsDialogProps {
  initialSectionId?: SettingsSectionId;
  open: boolean;
  saveError?: string | null;
  saveState?: SettingsSaveState;
  settings: AppSettings;
  onClose: () => void;
  onSettingsChange: (settings: AppSettings) => void;
}

export function SettingsDialog({
  initialSectionId,
  onClose,
  onSettingsChange,
  open,
  saveError,
  saveState,
  settings,
}: SettingsDialogProps) {
  return (
    <ModalShell
      description="主题、终端外观、AI 与模型、快捷键集中在这里调整。"
      onClose={onClose}
      open={open}
      size="wide"
      title="设置"
    >
      <SettingsToolContent
        initialSectionId={initialSectionId}
        onSettingsChange={onSettingsChange}
        saveError={saveError}
        saveState={saveState}
        settings={settings}
      />
    </ModalShell>
  );
}
