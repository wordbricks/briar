import { defineRule } from "@oxlint/plugins";

import type { ESTree, Variable } from "@oxlint/plugins";

const RAW_TAURI_MODULES = new Set([
  "@tauri-apps/api",
  "@tauri-apps/api/core",
  "@tauri-apps/api/event",
  "@tauri-apps/api/index",
]);
const GENERATED_BINDINGS_PATH = "/apps/briar/src/generated/tauri.ts";
const AUTH_SESSION_PATH = "/apps/briar/src/lib/auth-session.ts";
const AUTH_SESSION_COMMAND = "plugin:auth-session|start";

function normalizedFilename(filename: string): string {
  return filename.replaceAll("\\", "/");
}

function isFile(filename: string, repositoryPath: string): boolean {
  return normalizedFilename(filename).endsWith(repositoryPath);
}

function expressionString(expression: ESTree.Expression): string | null {
  return expression.type === "Literal" && typeof expression.value === "string"
    ? expression.value
    : null;
}

function isRawTauriModule(source: string | null): source is string {
  return source !== null && RAW_TAURI_MODULES.has(source);
}

function exactAuthSessionInvokeDeclarator(
  node: ESTree.ImportExpression,
): ESTree.VariableDeclarator | null {
  const awaitExpression = node.parent;
  if (
    awaitExpression.type !== "AwaitExpression" ||
    awaitExpression.argument !== node
  ) {
    return null;
  }

  const declarator = awaitExpression.parent;
  if (
    declarator.type !== "VariableDeclarator" ||
    declarator.init !== awaitExpression ||
    declarator.id.type !== "ObjectPattern" ||
    declarator.id.properties.length !== 1
  ) {
    return null;
  }

  const [property] = declarator.id.properties;
  return (
    property?.type === "Property" &&
    !property.computed &&
    property.key.type === "Identifier" &&
    property.key.name === "invoke" &&
    property.value.type === "Identifier" &&
    property.value.name === "invoke"
  )
    ? declarator
    : null;
}

function isExactAuthSessionInvokeCall(
  identifier: ESTree.IdentifierReference,
): boolean {
  const call = identifier.parent;
  if (call.type !== "CallExpression" || call.callee !== identifier) return false;
  const command = call.arguments[0];
  return command?.type === "Literal" && command.value === AUTH_SESSION_COMMAND;
}

/** Keep app-owned Tauri IPC behind the bindings generated from the Rust contract. */
export const noRawTauriIpcRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow raw Tauri app IPC imports outside generated bindings and an exact native plugin call.",
    },
    messages: {
      rawTauriIpc:
        "Import app IPC from the generated Tauri bindings; raw `{{module}}` access bypasses the Rust SSOT.",
      invalidAuthSessionInvoke:
        "The auth-session exception only permits `invoke(\"plugin:auth-session|start\", ...)`.",
    },
  },
  create(context) {
    const filename = normalizedFilename(context.filename);
    const isGeneratedBindings = isFile(filename, GENERATED_BINDINGS_PATH);
    const isAuthSession = isFile(filename, AUTH_SESSION_PATH);
    const authInvokeVariables: Variable[] = [];

    const checkModule = (
      node:
        | ESTree.ExportAllDeclaration
        | ESTree.ExportNamedDeclaration
        | ESTree.ImportDeclaration
        | ESTree.ImportExpression,
      source: string | null,
    ) => {
      if (!isRawTauriModule(source) || isGeneratedBindings) return;
      const authInvokeDeclarator =
        isAuthSession &&
        source === "@tauri-apps/api/core" &&
        node.type === "ImportExpression"
          ? exactAuthSessionInvokeDeclarator(node)
          : null;
      if (authInvokeDeclarator !== null) {
        const invokeVariable = context.sourceCode.scopeManager
          .getDeclaredVariables(authInvokeDeclarator)
          .find((variable) => variable.name === "invoke");
        if (invokeVariable !== undefined) {
          authInvokeVariables.push(invokeVariable);
          return;
        }
      }
      context.report({
        node,
        messageId: "rawTauriIpc",
        data: { module: source },
      });
    };

    return {
      ImportDeclaration(node) {
        checkModule(node, node.source.value);
      },
      ImportExpression(node) {
        checkModule(node, expressionString(node.source));
      },
      ExportNamedDeclaration(node) {
        checkModule(node, node.source?.value ?? null);
      },
      ExportAllDeclaration(node) {
        checkModule(node, node.source.value);
      },
      "Program:exit"() {
        for (const variable of authInvokeVariables) {
          for (const reference of variable.references) {
            if (!reference.isRead()) continue;
            if (isExactAuthSessionInvokeCall(reference.identifier)) continue;
            context.report({
              node: reference.identifier,
              messageId: "invalidAuthSessionInvoke",
            });
          }
        }
      },
    };
  },
});
