import { useEffect, useRef, useState } from "react";
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
  const [draftSettings, setDraftSettings] = useState(settings);
  const [draftDirty, setDraftDirty] = useState(false);
  const [externalChangeNotice, setExternalChangeNotice] = useState<
    string | null
  >(null);
  const wasOpenRef = useRef(false);
  const lastSettingsFingerprintRef = useRef(settingsFingerprint(settings));

  useEffect(() => {
    const nextFingerprint = settingsFingerprint(settings);
    if (!open) {
      wasOpenRef.current = false;
      lastSettingsFingerprintRef.current = nextFingerprint;
      setDraftDirty(false);
      setExternalChangeNotice(null);
      return;
    }

    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      lastSettingsFingerprintRef.current = nextFingerprint;
      setDraftSettings(settings);
      setDraftDirty(false);
      setExternalChangeNotice(null);
      return;
    }

    if (nextFingerprint === lastSettingsFingerprintRef.current) {
      return;
    }
    lastSettingsFingerprintRef.current = nextFingerprint;

    if (!draftDirty || nextFingerprint === settingsFingerprint(draftSettings)) {
      setDraftSettings(settings);
      setDraftDirty(false);
      setExternalChangeNotice(null);
      return;
    }

    setExternalChangeNotice(
      "cfg: settings changed externally; editor draft kept",
    );
  }, [draftDirty, draftSettings, open, settings]);

  useEffect(() => {
    if (open && saveState === "saved") {
      setDraftDirty(false);
    }
  }, [open, saveState]);

  const handleSettingsChange = (nextSettings: AppSettings) => {
    setDraftSettings(nextSettings);
    setDraftDirty(true);
    setExternalChangeNotice(null);
    onSettingsChange(nextSettings);
  };

  return (
    <ModalShell
      description="主题、终端、MCP、SFTP 和快捷键。"
      onClose={onClose}
      open={open}
      panelClassName="h-[min(780px,calc(100vh-48px))]"
      size="wide"
      title="设置"
    >
      <SettingsToolContent
        externalChangeNotice={externalChangeNotice}
        initialSectionId={initialSectionId}
        onSettingsChange={handleSettingsChange}
        saveError={saveError}
        saveState={saveState}
        settings={draftSettings}
      />
    </ModalShell>
  );
}

function settingsFingerprint(settings: AppSettings) {
  return JSON.stringify(settings);
}
