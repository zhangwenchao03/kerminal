//! Profile TOML repository operations.

use super::*;

impl ConfigFileStore {
    /// Read a profile from `profiles/<profile-id>.toml`.
    pub fn read_profile(&self, profile_id: &str) -> FileStoreResult<TerminalProfile> {
        let relative_path = profile_relative_path(profile_id)?;
        let document = self
            .files
            .read_toml::<ProfileTomlDocument>(&relative_path)?;
        let profile = with_error_path(document.into_profile(), &relative_path)?;
        if profile.id != profile_id {
            return Err(FileStoreError::TomlParse(
                TomlParseError::single(
                    1,
                    1,
                    format!(
                        "profile file id mismatch: expected {profile_id}, found {}",
                        profile.id
                    ),
                )
                .with_path(relative_path)
                .with_key("id")
                .with_recovery("Make the profile id match the profiles/<id>.toml file name."),
            ));
        }
        Ok(profile)
    }

    /// Read all profile TOML files ordered by sort order and name.
    pub fn list_profiles(&self) -> FileStoreResult<Vec<TerminalProfile>> {
        let profiles_dir = self.files.path_for(PROFILES_RELATIVE_DIR)?;
        let entries = match fs::read_dir(&profiles_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };

        let mut profiles = Vec::new();
        for entry in entries {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if !file_type.is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("toml") {
                continue;
            }
            let Some(profile_id) = path.file_stem().and_then(|value| value.to_str()) else {
                continue;
            };
            profiles.push(self.read_profile(profile_id)?);
        }

        profiles.sort_by(|left, right| {
            left.sort_order
                .cmp(&right.sort_order)
                .then_with(|| left.name.cmp(&right.name))
        });
        Ok(profiles)
    }

    /// Read one profile, returning `None` when the profile file does not exist.
    pub fn profile_by_id(&self, profile_id: &str) -> FileStoreResult<Option<TerminalProfile>> {
        match self.read_profile(profile_id) {
            Ok(profile) => Ok(Some(profile)),
            Err(FileStoreError::Io(error)) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Write a profile to `profiles/<profile-id>.toml`.
    pub fn write_profile(&self, profile: &TerminalProfile) -> FileStoreResult<PathBuf> {
        let relative_path = profile_relative_path(&profile.id)?;
        let document = ProfileTomlDocument::from_profile(profile.clone());
        self.files.write_toml(relative_path, &document)
    }

    /// Apply profile writes/deletes as a single recoverable change set.
    pub fn apply_profile_change_set(
        &self,
        profiles_to_write: &[TerminalProfile],
        profile_ids_to_delete: &[String],
    ) -> FileStoreResult<()> {
        let timestamp = timestamp_now();
        let change_set_id = format!("profiles-{}", Uuid::new_v4());
        let mut changes = Vec::with_capacity(profiles_to_write.len() + profile_ids_to_delete.len());

        for profile in profiles_to_write {
            let relative_path = profile_relative_path(&profile.id)?;
            let document = ProfileTomlDocument::from_profile(profile.clone());
            changes.push(FileStoreChange::new(
                relative_path,
                document.encode_toml()?.into_bytes(),
            )?);
        }

        for profile_id in profile_ids_to_delete {
            changes.push(FileStoreChange::delete(profile_relative_path(profile_id)?)?);
        }

        self.files
            .apply_change_set(&change_set_id, &timestamp, changes)?;
        Ok(())
    }
}
