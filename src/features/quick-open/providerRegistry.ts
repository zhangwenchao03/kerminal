import type { QuickOpenProvider } from "./types";

export class DuplicateQuickOpenProviderError extends Error {
  constructor(providerId: string) {
    super(`Quick Open provider 已注册：${providerId}`);
    this.name = "DuplicateQuickOpenProviderError";
  }
}

/** 可扩展的强类型 Provider 注册表，不持有任何 store。 */
export class QuickOpenProviderRegistry {
  readonly #providers = new Map<string, QuickOpenProvider>();

  register(provider: QuickOpenProvider): this {
    if (this.#providers.has(provider.id)) {
      throw new DuplicateQuickOpenProviderError(provider.id);
    }
    this.#providers.set(provider.id, provider);
    return this;
  }

  unregister(providerId: string): boolean {
    return this.#providers.delete(providerId);
  }

  list(): readonly QuickOpenProvider[] {
    return [...this.#providers.values()];
  }
}

