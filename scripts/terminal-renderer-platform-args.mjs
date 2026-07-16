export function readGpuMode(value) {
  if (!["hardware", "software"].includes(value)) {
    throw new Error("--gpu-mode must be hardware or software.");
  }
  return value;
}

export function readPositiveNumber(value, fallback, label) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return parsed;
}
