import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as JsonSchema from "effect/JsonSchema";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { mobileOperationCatalog } from "../packages/mobile-contracts/src/index";

type JsonObject = Record<string, unknown>;

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const openApiPath = resolve(
  workspaceRoot,
  "packages/mobile-contracts/companion.openapi.yaml",
);
const swiftPath = resolve(
  workspaceRoot,
  "apps/briar/ios/BriarCompanion/App/Generated/MobileAPI.generated.swift",
);
const mobileOperations = Object.values(mobileOperationCatalog);

const objectAt = (value: unknown, label: string): JsonObject => {
  if (!Predicate.isObject(value) || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
};

const stringAt = (value: unknown, label: string): string => {
  if (!Predicate.isString(value)) throw new Error(`${label} must be a string`);
  return value;
};

const operationSchemaDocument = (
  schema: Schema.Constraint,
  additionalProperties: boolean,
) => {
  const document = Schema.toJsonSchemaDocument(schema, {
    additionalProperties,
    generateDescriptions: true,
  });
  return JsonSchema.toMultiDocumentOpenApi3_1({
    dialect: "draft-2020-12",
    schemas: [document.schema],
    definitions: document.definitions,
  });
};

const jsonValueEnd = (source: string, start: number): number => {
  const opening = source[start];
  if (opening !== "{" && opening !== "[") {
    throw new Error(`Expected a JSON object or array at offset ${start}`);
  }
  let depth = 0;
  let insideString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (insideString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') insideString = false;
      continue;
    }
    if (character === '"') insideString = true;
    else if (character === "{" || character === "[") depth += 1;
    else if (character === "}" || character === "]") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  throw new Error(`Unterminated JSON value at offset ${start}`);
};

const replaceJsonProperty = (
  source: string,
  indentation: number,
  propertyName: string,
  value: unknown,
) => {
  const prefix = " ".repeat(indentation);
  const marker = `${prefix}${JSON.stringify(propertyName)}: `;
  const markerStart = source.indexOf(marker);
  if (markerStart < 0) {
    throw new Error(`Could not find generated OpenAPI property ${propertyName}`);
  }
  if (source.indexOf(marker, markerStart + marker.length) >= 0) {
    throw new Error(`OpenAPI property ${propertyName} is ambiguous`);
  }
  const valueStart = markerStart + marker.length;
  const valueEnd = jsonValueEnd(source, valueStart);
  const rendered = JSON.stringify(value, null, 2).replaceAll(
    "\n",
    `\n${prefix}`,
  );
  return `${source.slice(0, valueStart)}${rendered}${source.slice(valueEnd)}`;
};

const insertJsonObjectProperty = (
  source: string,
  parentIndentation: number,
  parentName: string,
  childIndentation: number,
  childName: string,
  value: unknown,
) => {
  const parentPrefix = " ".repeat(parentIndentation);
  const parentMarker = `${parentPrefix}${JSON.stringify(parentName)}: `;
  const parentStart = source.indexOf(parentMarker);
  if (parentStart < 0) {
    throw new Error(`Could not find OpenAPI parent property ${parentName}`);
  }
  if (source.indexOf(parentMarker, parentStart + parentMarker.length) >= 0) {
    throw new Error(`OpenAPI parent property ${parentName} is ambiguous`);
  }
  const valueStart = parentStart + parentMarker.length;
  const valueEnd = jsonValueEnd(source, valueStart);
  if (source[valueStart] !== "{") {
    throw new Error(`OpenAPI parent property ${parentName} must be an object`);
  }

  const closingBrace = valueEnd - 1;
  let contentEnd = closingBrace;
  while (/\s/u.test(source[contentEnd - 1] ?? "")) contentEnd -= 1;

  const childPrefix = " ".repeat(childIndentation);
  const rendered = JSON.stringify(value, null, 2).replaceAll(
    "\n",
    `\n${childPrefix}`,
  );
  const property = `${childPrefix}${JSON.stringify(childName)}: ${rendered}`;

  if (contentEnd === valueStart + 1) {
    return `${source.slice(0, valueStart + 1)}\n${property}\n${parentPrefix}${source.slice(closingBrace)}`;
  }
  return `${source.slice(0, contentEnd)},\n${property}${source.slice(contentEnd)}`;
};

const upsertJsonObjectProperty = (
  source: string,
  parentIndentation: number,
  parentName: string,
  childIndentation: number,
  childName: string,
  value: unknown,
) => {
  const childMarker = `${" ".repeat(childIndentation)}${JSON.stringify(childName)}: `;
  return source.includes(childMarker)
    ? replaceJsonProperty(source, childIndentation, childName, value)
    : insertJsonObjectProperty(
      source,
      parentIndentation,
      parentName,
      childIndentation,
      childName,
      value,
    );
};

export const renderOpenApi = (source: string): string => {
  const openApi = objectAt(JSON.parse(source), "OpenAPI document");
  const paths = objectAt(openApi.paths, "OpenAPI paths");
  const components = objectAt(openApi.components, "OpenAPI components");
  objectAt(components.schemas, "OpenAPI component schemas");

  let output = source;
  const generatedComponents = new Map<string, string>();
  for (const operation of mobileOperations) {
    if (operation.request !== undefined) {
      throw new Error(
        `OpenAPI request generation is not implemented for ${operation.id}`,
      );
    }
    const generated = operationSchemaDocument(
      operation.response.schema,
      true,
    );
    for (const [name, schema] of Object.entries(generated.definitions)) {
      const serialized = JSON.stringify(schema);
      const previous = generatedComponents.get(name);
      if (previous !== undefined && previous !== serialized) {
        throw new Error(`Conflicting generated OpenAPI component ${name}`);
      }
      generatedComponents.set(name, serialized);
      output = upsertJsonObjectProperty(
        output,
        4,
        "schemas",
        6,
        name,
        schema,
      );
    }

    const rewrittenPaths = new Set<string>();
    for (const [path, rawPathItem] of Object.entries(paths)) {
      const candidate = objectAt(rawPathItem, `OpenAPI path ${path}`);
      for (const [method, rawOperation] of Object.entries(candidate)) {
        if (
          Predicate.isObject(rawOperation) &&
          !Array.isArray(rawOperation) &&
          rawOperation.operationId === operation.id
        ) {
          delete candidate[method];
          rewrittenPaths.add(path);
        }
      }
    }
    paths[operation.path] ??= {};
    const pathItem = objectAt(
      paths[operation.path],
      `OpenAPI path ${operation.path}`,
    );
    pathItem[operation.method.toLowerCase()] = {
      operationId: operation.id,
      ...(operation.security === "bearer"
        ? { security: [{ bearerAuth: [] }] }
        : {}),
      responses: {
        [String(operation.response.status)]: {
          description: operation.response.description,
          content: {
            [operation.response.contentType]: {
              schema: {
                $ref: `#/components/schemas/${operation.response.component}`,
              },
            },
          },
        },
        ...Object.fromEntries(operation.errors.map((error) => [
          String(error.status),
          {
            $ref:
              `#/components/responses/${error.responseComponent}`,
          },
        ])),
      },
    };
    rewrittenPaths.add(operation.path);
    for (const path of rewrittenPaths) {
      output = upsertJsonObjectProperty(
        output,
        2,
        "paths",
        4,
        path,
        paths[path],
      );
    }
  }

  return output.endsWith("\n") ? output : `${output}\n`;
};

type SwiftEnum = {
  readonly name: string;
  readonly values: readonly string[];
};

type SwiftProperty = {
  readonly name: string;
  readonly type: string;
  readonly baseType: string;
  readonly required: boolean;
  readonly optional: boolean;
  readonly nullable: boolean;
};

type SwiftType = {
  readonly baseType: string;
  readonly nullable: boolean;
};

const upperFirst = (value: string) =>
  `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;

const swiftKeywords = new Set([
  "Any",
  "Self",
  "actor",
  "any",
  "as",
  "associatedtype",
  "await",
  "borrowing",
  "break",
  "case",
  "catch",
  "class",
  "consuming",
  "continue",
  "default",
  "defer",
  "deinit",
  "distributed",
  "do",
  "each",
  "else",
  "enum",
  "extension",
  "fallthrough",
  "false",
  "fileprivate",
  "for",
  "func",
  "guard",
  "if",
  "import",
  "in",
  "init",
  "inout",
  "internal",
  "is",
  "let",
  "macro",
  "nil",
  "nonisolated",
  "open",
  "operator",
  "package",
  "precedencegroup",
  "private",
  "protocol",
  "public",
  "repeat",
  "rethrows",
  "return",
  "self",
  "some",
  "static",
  "struct",
  "subscript",
  "super",
  "switch",
  "throw",
  "throws",
  "true",
  "try",
  "typealias",
  "var",
  "where",
  "while",
]);

const swiftIdentifier = (value: string) => {
  const camel = value.replace(/[^A-Za-z0-9]+(.)/gu, (_, character: string) =>
    character.toUpperCase()
  );
  const nonEmpty = camel.length === 0 ? "value" : camel;
  const identifier = /^\d/u.test(nonEmpty) ? `_${nonEmpty}` : nonEmpty;
  return swiftKeywords.has(identifier)
    ? `\`${identifier}\``
    : identifier;
};

const referenceName = (schema: JsonObject): string | undefined => {
  if (!Predicate.isString(schema.$ref)) return undefined;
  const prefix = "#/components/schemas/";
  if (!schema.$ref.startsWith(prefix)) {
    throw new Error(`Unsupported schema reference: ${schema.$ref}`);
  }
  return schema.$ref.slice(prefix.length);
};

const schemaFormat = (schema: JsonObject): string | undefined => {
  if (Predicate.isString(schema.format)) return schema.format;
  if (!Array.isArray(schema.allOf)) return undefined;
  for (const branch of schema.allOf) {
    if (!Predicate.isObject(branch) || Array.isArray(branch)) continue;
    if (Predicate.isString(branch.format)) return branch.format;
  }
  return undefined;
};

const unwrapNullable = (schema: JsonObject) => {
  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf.filter((branch) =>
      Predicate.isObject(branch) && !Array.isArray(branch)
    );
    const nonNull = branches.filter((branch) => branch.type !== "null");
    const hasNull = branches.some((branch) => branch.type === "null");
    if (hasNull && nonNull.length === 1) {
      return { schema: nonNull[0], nullable: true } as const;
    }
  }
  return { schema, nullable: false } as const;
};

const swiftType = (
  rawSchema: JsonObject,
  propertyName: string,
  enums: SwiftEnum[],
): SwiftType => {
  const unwrapped = unwrapNullable(rawSchema);
  const schema = unwrapped.schema;
  const reference = referenceName(schema);
  let baseType: string;
  if (reference) {
    baseType = reference;
  } else if (schema.type === "array") {
    const items = objectAt(schema.items, `${propertyName}.items`);
    const itemType = swiftType(items, propertyName, enums);
    baseType = `[${itemType.baseType}${itemType.nullable ? "?" : ""}]`;
  } else if (schema.type === "string") {
    if (Array.isArray(schema.enum)) {
      const values = schema.enum.map((value, index) =>
        stringAt(value, `${propertyName}.enum[${index}]`)
      );
      baseType = upperFirst(propertyName);
      enums.push({ name: baseType, values });
    } else {
      const format = schemaFormat(schema);
      baseType = format === "uuid"
        ? "UUID"
        : format === "date-time"
          ? "Date"
          : "String";
    }
  } else if (schema.type === "boolean") {
    baseType = "Bool";
  } else if (schema.type === "integer") {
    baseType = "Int";
  } else if (schema.type === "number") {
    baseType = "Double";
  } else {
    throw new Error(
      `Unsupported Swift schema for ${propertyName}: ${JSON.stringify(schema)}`,
    );
  }
  return {
    baseType,
    nullable: unwrapped.nullable,
  };
};

export const renderSwiftObject = (
  name: string,
  schema: JsonObject,
): string => {
  if (schema.type !== "object") throw new Error(`${name} must be an object schema`);
  const properties = objectAt(schema.properties, `${name}.properties`);
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.map((value, index) =>
        stringAt(value, `${name}.required[${index}]`)
      )
      : [],
  );
  const enums: SwiftEnum[] = [];
  const fields: SwiftProperty[] = Object.entries(properties).map(
    ([propertyName, propertySchema]) => {
      const schemaObject = objectAt(
        propertySchema,
        `${name}.${propertyName}`,
      );
      const type = swiftType(schemaObject, propertyName, enums);
      const isOptional = type.nullable || !required.has(propertyName);
      return {
        name: propertyName,
        type: `${type.baseType}${isOptional ? "?" : ""}`,
        baseType: type.baseType,
        required: required.has(propertyName),
        optional: isOptional,
        nullable: type.nullable,
      };
    },
  );

  const needsCustomCodable = fields.some((field) => field.optional);
  const lines = [`struct ${name}: Codable, Equatable, Sendable {`];
  for (const field of fields) lines.push(`    let ${field.name}: ${field.type}`);

  for (const swiftEnum of enums) {
    lines.push("");
    lines.push(`    enum ${swiftEnum.name}: String, Codable, Sendable {`);
    for (const value of swiftEnum.values) {
      const identifier = swiftIdentifier(value);
      lines.push(identifier === value
        ? `        case ${identifier}`
        : `        case ${identifier} = ${JSON.stringify(value)}`);
    }
    lines.push("    }");
  }

  if (needsCustomCodable) {
    lines.push("");
    lines.push("    init(");
    fields.forEach((field, index) => {
      const defaultSuffix = !field.required && field.optional ? " = nil" : "";
      lines.push(
        `        ${field.name}: ${field.type}${defaultSuffix}${index === fields.length - 1 ? "" : ","}`,
      );
    });
    lines.push("    ) {");
    for (const field of fields) lines.push(`        self.${field.name} = ${field.name}`);
    lines.push("    }");
    lines.push("");
    lines.push("    enum CodingKeys: String, CodingKey {");
    for (const field of fields) lines.push(`        case ${field.name}`);
    lines.push("    }");
    lines.push("");
    lines.push("    init(from decoder: Decoder) throws {");
    lines.push("        let container = try decoder.container(keyedBy: CodingKeys.self)");
    for (const field of fields) {
      if (field.required && field.nullable) {
        lines.push(`        guard container.contains(.${field.name}) else {`);
        lines.push("            throw DecodingError.keyNotFound(");
        lines.push(`                CodingKeys.${field.name},`);
        lines.push("                DecodingError.Context(");
        lines.push("                    codingPath: decoder.codingPath,");
        lines.push(
          `                    debugDescription: ${JSON.stringify(`${field.name} is required`)}`,
        );
        lines.push("                )");
        lines.push("            )");
        lines.push("        }");
        lines.push(
          `        ${field.name} = try container.decode(${field.type}.self, forKey: .${field.name})`,
        );
      } else if (!field.required && !field.nullable) {
        lines.push(`        if container.contains(.${field.name}) {`);
        lines.push(
          `            ${field.name} = try container.decode(${field.baseType}.self, forKey: .${field.name})`,
        );
        lines.push("        } else {");
        lines.push(`            ${field.name} = nil`);
        lines.push("        }");
      } else if (!field.required && field.nullable) {
        lines.push(
          `        ${field.name} = try container.decodeIfPresent(${field.baseType}.self, forKey: .${field.name})`,
        );
      } else {
        lines.push(
          `        ${field.name} = try container.decode(${field.type}.self, forKey: .${field.name})`,
        );
      }
    }
    lines.push("    }");
    lines.push("");
    lines.push("    func encode(to encoder: Encoder) throws {");
    lines.push("        var container = encoder.container(keyedBy: CodingKeys.self)");
    for (const field of fields) {
      lines.push(field.required
        ? `        try container.encode(${field.name}, forKey: .${field.name})`
        : `        try container.encodeIfPresent(${field.name}, forKey: .${field.name})`);
    }
    lines.push("    }");
  }

  lines.push("}");
  return lines.join("\n");
};

export const renderSwift = (): string => {
  const renderedResponses = new Map<string, string>();
  for (const operation of mobileOperations) {
    const generated = operationSchemaDocument(
      operation.response.schema,
      true,
    );
    const definitions: JsonObject = generated.definitions;
    for (const [definitionName, definitionSchema] of Object.entries(definitions)) {
      const rendered = renderSwiftObject(
        definitionName,
        objectAt(definitionSchema, definitionName),
      );
      const previous = renderedResponses.get(definitionName);
      if (previous !== undefined && previous !== rendered) {
        throw new Error(
          `Conflicting generated Swift response ${definitionName}`,
        );
      }
      renderedResponses.set(definitionName, rendered);
    }
    if (!renderedResponses.has(operation.response.component)) {
      throw new Error(
        `Missing generated Swift response ${operation.response.component}`,
      );
    }
  }
  const responses = [...renderedResponses.values()].join("\n\n");
  const operations = mobileOperations.map((operation) => {
    const operationType = operation.security === "bearer"
      ? "AuthenticatedMobileAPIOperation"
      : "PublicMobileAPIOperation";
    return `    static let ${swiftIdentifier(operation.id)} = ${operationType}<${operation.response.component}>(
        id: ${JSON.stringify(operation.id)},
        method: ${JSON.stringify(operation.method)},
        path: ${JSON.stringify(operation.path)}
    )`;
  }).join("\n\n");
  return `// Generated by scripts/generate-mobile-contracts.ts. Do not edit.

import Foundation

${responses}

enum MobileAPIOperations {
${operations}
}
`;
};

export const generateMobileContracts = async (check: boolean) => {
  const currentOpenApi = await readFile(openApiPath, "utf8");
  const outputs = [
    {
      path: openApiPath,
      current: currentOpenApi,
      generated: renderOpenApi(currentOpenApi),
    },
    {
      path: swiftPath,
      current: await readFile(swiftPath, "utf8").catch(() => ""),
      generated: renderSwift(),
    },
  ] as const;

  if (check) {
    const stale = outputs.filter((output) =>
      output.current !== output.generated
    );
    if (stale.length > 0) {
      for (const output of stale) {
        console.error(
          `${output.path} is stale; run \`bun run mobile:contract:generate\``,
        );
      }
      process.exitCode = 1;
    }
  } else {
    for (const output of outputs) {
      await mkdir(dirname(output.path), { recursive: true });
      await writeFile(output.path, output.generated);
      console.log(`Generated ${output.path}`);
    }
  }
};

if (import.meta.main) {
  await generateMobileContracts(process.argv.includes("--check"));
}
