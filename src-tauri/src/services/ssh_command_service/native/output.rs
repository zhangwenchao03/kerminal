#[derive(Debug)]
pub(super) struct LimitedRawOutputBuffer {
    captured: Vec<u8>,
    max_bytes: usize,
}

impl LimitedRawOutputBuffer {
    pub(super) fn new(max_bytes: usize) -> Self {
        Self {
            captured: Vec::with_capacity(max_bytes.min(8 * 1024)),
            max_bytes,
        }
    }

    pub(super) fn push(&mut self, bytes: &[u8]) {
        let remaining = self.max_bytes.saturating_sub(self.captured.len());
        if remaining == 0 {
            return;
        }
        let visible = bytes.len().min(remaining);
        self.captured.extend_from_slice(&bytes[..visible]);
    }

    pub(super) fn finish(self) -> Vec<u8> {
        self.captured
    }
}
