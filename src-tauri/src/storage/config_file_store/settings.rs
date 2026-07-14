//! Settings TOML repository operations.

use super::*;

impl ConfigFileStore {
    /// Read `settings.toml` and validate it into the runtime settings model.
    pub fn read_settings(&self) -> FileStoreResult<AppSettings> {
        let document = self
            .files
            .read_toml::<SettingsTomlDocument>(SETTINGS_RELATIVE_PATH)?;
        with_error_path(document.into_settings(), Path::new(SETTINGS_RELATIVE_PATH))
    }

    /// Read `settings.toml`, returning defaults when the file is not initialized yet.
    pub fn read_settings_or_default(&self) -> FileStoreResult<AppSettings> {
        match self.read_settings() {
            Ok(settings) => Ok(settings),
            Err(FileStoreError::Io(error)) if error.kind() == ErrorKind::NotFound => {
                Ok(AppSettings::default())
            }
            Err(error) => Err(error),
        }
    }

    /// Write runtime settings to `settings.toml`.
    pub fn write_settings(&self, settings: &AppSettings) -> FileStoreResult<PathBuf> {
        let document = SettingsTomlDocument::from_settings(settings.clone())?;
        self.files.write_toml(SETTINGS_RELATIVE_PATH, &document)
    }
}
