import { createZodDto } from "nestjs-zod";
import type { z } from "zod";

type MetadataFactory = (this: unknown) => Record<string, Record<string, unknown>>;
type FactoryHolder = { _OPENAPI_METADATA_FACTORY?: MetadataFactory };

/**
 * nestjs-zod describes a nullable field as `type: ["string", "null"]`. @nestjs/swagger reads any
 * array-valued `type` as a nested array and emits `{ type: "array", items: ... }`, which is wrong.
 * This rewrites such properties to `nullable: true` (3.0 form), which swagger passes through and
 * nestjs-zod's cleanupOpenApiDoc converts to `anyOf` for OpenAPI 3.1.
 */
function normalizeFactory(cls: FactoryHolder): void {
  const original = cls._OPENAPI_METADATA_FACTORY;
  if (!original) return;
  cls._OPENAPI_METADATA_FACTORY = function (this: unknown) {
    const props = original.call(this ?? cls);
    for (const [key, prop] of Object.entries(props)) {
      const type = prop.type;
      if (!Array.isArray(type)) continue;
      const types = (type as string[]).filter((t) => t !== "null");
      const nullable = types.length !== type.length;
      const { type: _drop, ...rest } = prop;
      props[key] = types.length === 1
        ? { ...rest, type: types[0], ...(nullable ? { nullable: true } : {}) }
        : { ...rest, anyOf: types.map((t) => ({ type: t })), ...(nullable ? { nullable: true } : {}) };
    }
    return props;
  };
}

/** createZodDto with the nullable fix applied to both the input DTO and its `.Output` variant. */
export function zodDto<T extends z.ZodType>(schema: T) {
  const Dto = createZodDto(schema);
  normalizeFactory(Dto as unknown as FactoryHolder);
  const outputDescriptor = Object.getOwnPropertyDescriptor(Dto, "Output");
  if (outputDescriptor?.get) {
    const getter = outputDescriptor.get;
    Object.defineProperty(Dto, "Output", {
      configurable: true,
      get() {
        const Output = getter.call(this);
        normalizeFactory(Output as FactoryHolder);
        return Output;
      },
    });
  }
  return Dto;
}
