import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const mainPath = "electron/main.ts";
const mainOwner = "electron/mainWindowPermissions.ts";
const embeddedOwner = "electron/embeddedBrowserPermissions.ts";
const cloudOwner = "electron/cloudDesktopWindowFactory.ts";
const mainInstaller = "installMainWindowPermissionHandlers";
const retiredIdentifiers = new Set([
  "installMainWindowMediaPermissionHandler",
  "shouldAllowMainWindowMediaPermission",
]);
const permissionSetters = new Set([
  "setPermissionRequestHandler",
  "setPermissionCheckHandler",
]);

function moduleStem(specifier) {
  return path.posix.basename(specifier).replace(/\.[cm]?[jt]sx?$/, "");
}

function collectSources(repoRoot, directory = "electron") {
  const absoluteDirectory = path.join(repoRoot, directory);
  if (!fs.existsSync(absoluteDirectory)) return [];
  return fs
    .readdirSync(absoluteDirectory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const relativePath = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (["__tests__", "__mocks__", "node_modules"].includes(entry.name))
          return [];
        return collectSources(repoRoot, relativePath);
      }
      return entry.isFile() &&
        /\.[cm]?[jt]sx?$/.test(entry.name) &&
        !/\.(?:test|spec|testHarness)\.[cm]?[jt]sx?$/.test(entry.name)
        ? [relativePath]
        : [];
    });
}

function moduleReference(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return node.moduleSpecifier;
  }
  if (
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === "require"))
  ) {
    return node.arguments[0];
  }
  return undefined;
}

function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }
  return undefined;
}

function setterReference(node) {
  const member = memberName(node);
  if (permissionSetters.has(member)) return member;
  if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
    const key = node.propertyName ?? node.name;
    if (
      (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) &&
      permissionSetters.has(key.text)
    ) {
      return key.text;
    }
  }
  return undefined;
}

function installerBindings(source, relativePath) {
  const named = new Set();
  const namespaces = new Set();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.importClause?.isTypeOnly
    ) {
      continue;
    }
    const importedPath = path.posix
      .normalize(
        path.posix.join(
          path.posix.dirname(relativePath),
          statement.moduleSpecifier.text,
        ),
      )
      .replace(/\.[cm]?[jt]sx?$/, "");
    if (importedPath !== mainOwner.replace(/\.ts$/, "")) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        if (
          !binding.isTypeOnly &&
          (binding.propertyName ?? binding.name).text === mainInstaller
        ) {
          named.add(binding.name.text);
        }
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    }
  }
  return { named, namespaces };
}

function isInstallerCall(node, bindings) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return bindings.named.has(callee.text);
  return (
    memberName(callee) === mainInstaller &&
    ts.isIdentifier(callee.expression) &&
    bindings.namespaces.has(callee.expression.text)
  );
}

function isDenyAllPermissionSetter(node, setter) {
  const call = node.parent;
  if (
    !ts.isCallExpression(call) ||
    call.expression !== node ||
    call.arguments.length !== 1
  ) {
    return false;
  }
  const handler = call.arguments[0];
  if (!ts.isArrowFunction(handler) || handler.modifiers?.length) return false;
  if (setter === "setPermissionCheckHandler") {
    return (
      handler.parameters.length === 0 &&
      handler.body.kind === ts.SyntaxKind.FalseKeyword
    );
  }
  const callback = handler.parameters[2]?.name;
  return (
    handler.parameters.length === 3 &&
    callback &&
    ts.isIdentifier(callback) &&
    ts.isCallExpression(handler.body) &&
    ts.isIdentifier(handler.body.expression) &&
    handler.body.expression.text === callback.text &&
    handler.body.arguments.length === 1 &&
    handler.body.arguments[0].kind === ts.SyntaxKind.FalseKeyword
  );
}

// 测试侧治理扫描：同一检测器用于真实 Electron 目录与恢复反例，不执行目标源码。
export function findPermissionOwnerViolations(repoRoot, retiredTargets) {
  const violations = retiredTargets
    .filter((target) => fs.existsSync(path.join(repoRoot, target)))
    .map((target) => ({ code: "retired-file", path: target }));
  const retiredModules = new Set(retiredTargets.map(moduleStem));
  const setterCounts = new Map(
    [...permissionSetters].map((setter) => [setter, 0]),
  );
  const cloudSetterCounts = new Map(
    [...permissionSetters].map((setter) => [setter, 0]),
  );
  let mainInstallations = 0;

  for (const relativePath of collectSources(repoRoot)) {
    const source = ts.createSourceFile(
      relativePath,
      fs.readFileSync(path.join(repoRoot, relativePath), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const bindings = installerBindings(source, relativePath);
    const report = (code, node) => {
      violations.push({
        code,
        path: relativePath,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      });
    };
    if (source.parseDiagnostics.length > 0) {
      violations.push({ code: "syntax-error", path: relativePath });
    }
    const visit = (node) => {
      if (ts.isIdentifier(node) && retiredIdentifiers.has(node.text)) {
        report("retired-identifier", node);
      }
      const importedModule = moduleReference(node);
      if (
        importedModule &&
        ts.isStringLiteralLike(importedModule) &&
        retiredModules.has(moduleStem(importedModule.text))
      ) {
        report("retired-import", node);
      }
      const setter = setterReference(node);
      if (setter) {
        if (relativePath === mainOwner) {
          setterCounts.set(setter, setterCounts.get(setter) + 1);
        } else if (relativePath === cloudOwner) {
          cloudSetterCounts.set(setter, cloudSetterCounts.get(setter) + 1);
          if (!isDenyAllPermissionSetter(node, setter)) {
            report("cloud-permission-policy", node);
          }
        } else if (relativePath !== embeddedOwner) {
          report("setter-outside-owner", node);
        }
      }
      if (isInstallerCall(node, bindings)) {
        if (relativePath === mainPath) mainInstallations += 1;
        else report("installer-outside-main", node);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  if (mainInstallations !== 1) {
    violations.push({
      code: "main-installer-count",
      path: mainPath,
      count: mainInstallations,
    });
  }
  for (const [setter, count] of setterCounts) {
    if (count !== 1) {
      violations.push({
        code: "main-setter-count",
        path: mainOwner,
        setter,
        count,
      });
    }
  }
  for (const [setter, count] of cloudSetterCounts) {
    if (count !== 1) {
      violations.push({
        code: "cloud-setter-count",
        path: cloudOwner,
        setter,
        count,
      });
    }
  }
  return violations;
}
