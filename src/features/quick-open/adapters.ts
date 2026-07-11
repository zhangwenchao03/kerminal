import type {
  QuickOpenCandidate,
  QuickOpenKind,
  QuickOpenProvider,
  QuickOpenQuery,
} from "./types";

export interface QuickOpenAdaptedObject<TKind extends QuickOpenKind = QuickOpenKind> {
  readonly kind: TKind;
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  readonly targetId?: string;
  readonly targetLabel?: string;
  readonly updatedAt?: string;
}

export type QuickOpenObjectResolver<TObject extends QuickOpenAdaptedObject> = (
  query: QuickOpenQuery,
) => Promise<readonly TObject[]> | readonly TObject[];

/**
 * 将主机、终端、文件、历史、片段、工作流或 Agent 会话数据适配为 Provider。
 * 数据由调用方注入，模块本身不读取 store，也不扫描远端目录。
 */
export function createQuickOpenObjectProvider(
  id: string,
  kinds: readonly QuickOpenKind[],
  resolve: QuickOpenObjectResolver<QuickOpenAdaptedObject>,
): QuickOpenProvider {
  return {
    id,
    kinds,
    async search(query): Promise<readonly QuickOpenCandidate[]> {
      const objects = await resolve(query);
      return objects.slice(0, query.limit).map((object) => ({
        reference: {
          kind: object.kind,
          id: object.id,
          targetId: object.targetId,
        },
        label: object.label,
        description: object.description,
        keywords: object.keywords,
        targetId: object.targetId,
        targetLabel: object.targetLabel,
        updatedAt: object.updatedAt,
      }));
    },
  };
}
