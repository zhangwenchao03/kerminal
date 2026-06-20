use super::*;

pub(super) fn normalize_path_request(
    request: DockerContainerPathRequest,
) -> AppResult<DockerContainerPathRequest> {
    Ok(DockerContainerPathRequest {
        host_id: normalize_required("SSH 主机 id", &request.host_id)?,
        container_id: normalize_required("容器 id", &request.container_id)?,
        runtime: request.runtime,
        path: normalize_remote_path(&request.path)?,
    })
}

pub(super) fn normalize_preview_request(
    request: DockerContainerPreviewRequest,
) -> AppResult<DockerContainerPreviewRequest> {
    Ok(DockerContainerPreviewRequest {
        host_id: normalize_required("SSH 主机 id", &request.host_id)?,
        container_id: normalize_required("容器 id", &request.container_id)?,
        runtime: request.runtime,
        path: normalize_remote_path(&request.path)?,
        max_bytes: request
            .max_bytes
            .map(|bytes| bytes.clamp(1, MAX_PREVIEW_BYTES)),
    })
}

pub(super) fn normalize_read_text_file_request(
    request: DockerContainerReadTextFileRequest,
) -> AppResult<DockerContainerReadTextFileRequest> {
    Ok(DockerContainerReadTextFileRequest {
        host_id: normalize_required("SSH 主机 id", &request.host_id)?,
        container_id: normalize_required("容器 id", &request.container_id)?,
        runtime: request.runtime,
        path: normalize_remote_path(&request.path)?,
        max_bytes: request
            .max_bytes
            .map(|bytes| bytes.clamp(1, MAX_TEXT_FILE_BYTES)),
    })
}

pub(super) fn normalize_write_text_file_request(
    request: DockerContainerWriteTextFileRequest,
) -> AppResult<DockerContainerWriteTextFileRequest> {
    Ok(DockerContainerWriteTextFileRequest {
        host_id: normalize_required("SSH 主机 id", &request.host_id)?,
        container_id: normalize_required("容器 id", &request.container_id)?,
        runtime: request.runtime,
        path: normalize_remote_path(&request.path)?,
        content: request.content,
        encoding: request.encoding.trim().to_owned(),
        expected_revision: request.expected_revision,
        create: request.create,
        overwrite_on_conflict: request.overwrite_on_conflict,
    })
}

pub(super) fn normalize_delete_request(
    request: DockerContainerDeleteRequest,
) -> AppResult<DockerContainerDeleteRequest> {
    Ok(DockerContainerDeleteRequest {
        host_id: normalize_required("SSH 主机 id", &request.host_id)?,
        container_id: normalize_required("容器 id", &request.container_id)?,
        runtime: request.runtime,
        path: normalize_remote_path(&request.path)?,
        directory: request.directory,
    })
}

pub(super) fn normalize_rename_request(
    request: DockerContainerRenameRequest,
) -> AppResult<DockerContainerRenameRequest> {
    Ok(DockerContainerRenameRequest {
        host_id: normalize_required("SSH 主机 id", &request.host_id)?,
        container_id: normalize_required("容器 id", &request.container_id)?,
        runtime: request.runtime,
        from_path: normalize_remote_path(&request.from_path)?,
        to_path: normalize_remote_path(&request.to_path)?,
    })
}

pub(super) fn normalize_chmod_request(
    request: DockerContainerChmodRequest,
) -> AppResult<DockerContainerChmodRequest> {
    Ok(DockerContainerChmodRequest {
        host_id: normalize_required("SSH 主机 id", &request.host_id)?,
        container_id: normalize_required("容器 id", &request.container_id)?,
        runtime: request.runtime,
        path: normalize_remote_path(&request.path)?,
        mode: normalize_chmod_mode(&request.mode)?,
    })
}

pub(super) fn normalize_transfer_request(
    request: DockerContainerTransferRequest,
) -> AppResult<DockerContainerTransferRequest> {
    Ok(DockerContainerTransferRequest {
        host_id: normalize_required("SSH 主机 id", &request.host_id)?,
        container_id: normalize_required("容器 id", &request.container_id)?,
        runtime: request.runtime,
        remote_path: normalize_remote_path(&request.remote_path)?,
        local_path: normalize_required("本地路径", &request.local_path)?,
        kind: request.kind,
    })
}

pub(super) fn normalize_remote_path(path: &str) -> AppResult<String> {
    let path = normalize_required("容器路径", path)?
        .replace('\\', "/")
        .split('/')
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .fold(Vec::<String>::new(), |mut segments, segment| {
            if segment == ".." {
                segments.pop();
            } else {
                segments.push(segment.to_owned());
            }
            segments
        });
    if path.is_empty() {
        Ok("/".to_owned())
    } else {
        Ok(format!("/{}", path.join("/")))
    }
}

pub(super) fn parent_remote_path(path: &str) -> Option<String> {
    let path = path.trim_end_matches('/');
    if path.is_empty() || path == "/" {
        return None;
    }
    let parent = path
        .rsplit_once('/')
        .map(|(parent, _)| parent)
        .unwrap_or("/");
    Some(if parent.is_empty() {
        "/".to_owned()
    } else {
        parent.to_owned()
    })
}

pub(super) fn remote_file_name(path: &str) -> AppResult<String> {
    path.trim_end_matches('/')
        .rsplit('/')
        .find(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| AppError::InvalidInput("容器路径缺少文件名".to_owned()))
}

pub(super) fn ensure_not_root_for_write(path: &str) -> AppResult<()> {
    if normalize_remote_path(path)? == "/" {
        return Err(AppError::InvalidInput(
            "不允许直接修改容器根目录 /".to_owned(),
        ));
    }
    Ok(())
}

pub(super) fn normalize_chmod_mode(mode: &str) -> AppResult<String> {
    let mode = normalize_required("权限模式", mode)?;
    if mode.len() < 3 || mode.len() > 4 || !mode.chars().all(|ch| matches!(ch, '0'..='7')) {
        return Err(AppError::InvalidInput(
            "权限模式必须是 3 到 4 位八进制数字".to_owned(),
        ));
    }
    Ok(mode)
}
