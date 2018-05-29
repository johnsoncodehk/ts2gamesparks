"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var ts = require("typescript");
var fs = require("fs");
var path = require("path");
var mkdirp = require("mkdirp");
var encoding = "utf8";
var moduleKeywork = "module_";
function getTsConfig() {
    var file = ts.findConfigFile(process.cwd(), ts.sys.fileExists);
    var config = ts.readJsonConfigFile(file, ts.sys.readFile);
    var content = ts.parseJsonSourceFileConfigFileContent(config, ts.sys, path.dirname(file));
    return content;
}
function getLanguageService(tsConfig) {
    var files = {};
    tsConfig.fileNames.forEach(function (fileName) {
        files[fileName] = { version: 0 };
    });
    var servicesHost = {
        getScriptFileNames: function () { return tsConfig.fileNames; },
        getScriptVersion: function (fileName) { return files[fileName] && files[fileName].version.toString(); },
        getScriptSnapshot: function (fileName) {
            if (!fs.existsSync(fileName)) {
                return undefined;
            }
            return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName).toString());
        },
        getCurrentDirectory: function () { return process.cwd(); },
        getCompilationSettings: function () { return tsConfig.options; },
        getDefaultLibFileName: function (options) { return ts.getDefaultLibFilePath(options); },
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
    };
    return ts.createLanguageService(servicesHost, ts.createDocumentRegistry());
}
function buildFile(tsConfig, services, filePath) {
    function createSourceFile(filePath, sourceCode, scriptTarget) {
        return ts.createSourceFile(filePath, sourceCode, scriptTarget);
    }
    function getModuleExportsName(name) {
        return moduleKeywork + name;
    }
    function getModuleFuncHeader(name) {
        return getModuleExportsName(name) + "_";
    }
    function updateTsSourceFileFromData(tsSourceFile) {
        return ts.createPrinter().printFile(tsSourceFile);
    }
    function updateTsSourceFileFromText(tsSourceFile) {
        return createSourceFile(tsSourceFile.fileName, tsSourceFile.text, tsSourceFile.languageVersion);
    }
    function getRenameInfo(services, filePath, startPos, newName) {
        var result = services.findRenameLocations(filePath, startPos, false, false);
        return result.filter(function (r) { return r.fileName == filePath; }).map(function (r) {
            return {
                renameLocation: r,
                newName: newName,
            };
        });
    }
    function doRename(tsSourceFile, infos) {
        infos = infos.sort(function (a, b) { return b.renameLocation.textSpan.start - a.renameLocation.textSpan.start; });
        for (var _i = 0, infos_1 = infos; _i < infos_1.length; _i++) {
            var info = infos_1[_i];
            var text = tsSourceFile.text;
            text = text.substr(0, info.renameLocation.textSpan.start) + info.newName + text.substr(info.renameLocation.textSpan.start + info.renameLocation.textSpan.length);
            tsSourceFile.text = text;
        }
        return updateTsSourceFileFromText(tsSourceFile);
    }
    var fileName = path.basename(filePath, ".ts");
    var sourceCode = fs.readFileSync(filePath, encoding);
    var tsSourceFile = createSourceFile(filePath, sourceCode, tsConfig.options.target);
    var isExportModule = !!tsSourceFile.statements.find(function (s) { return s.modifiers && !!s.modifiers.find(function (m) { return m.kind == ts.SyntaxKind.ExportKeyword; }); });
    var renameInfos = [];
    var importModules = [];
    if (isExportModule) {
        tsSourceFile.forEachChild(function (node) {
            if (ts.isFunctionDeclaration(node) && node.name) {
                var newName = getModuleFuncHeader(fileName) + node.name.escapedText;
                renameInfos = renameInfos.concat(getRenameInfo(services, filePath, node.name.end, newName));
            }
            else if (ts.isVariableStatement(node)) {
                node.declarationList.declarations.forEach(function (declaration) {
                    var declarationAny = declaration;
                    var newName = getModuleFuncHeader(fileName) + declarationAny.name.escapedText;
                    renameInfos = renameInfos.concat(getRenameInfo(services, filePath, declaration.name.end, newName));
                });
            }
        });
    }
    tsSourceFile.forEachChild(function (node) {
        if (ts.isImportDeclaration(node)) {
            if (node.importClause.namedBindings.name) {
                var namedBindings = node.importClause.namedBindings;
                renameInfos = renameInfos.concat(getRenameInfo(services, filePath, namedBindings.name.end, getModuleExportsName(node.moduleSpecifier.text)));
                if (importModules.indexOf(node.moduleSpecifier.text) == -1)
                    importModules.push(node.moduleSpecifier.text);
            }
        }
    });
    tsSourceFile.forEachChild(function (node) {
        if (ts.isImportDeclaration(node)) {
            if (node.importClause.namedBindings.elements) {
                var namedBindings = node.importClause.namedBindings;
                namedBindings.elements.forEach(function (element) {
                    var funcName = element.propertyName ? element.propertyName.escapedText : element.name.escapedText;
                    var funcHeader = getModuleFuncHeader(node.moduleSpecifier.text);
                    renameInfos = renameInfos.concat(getRenameInfo(services, filePath, element.name.end, funcHeader + funcName));
                    if (importModules.indexOf(node.moduleSpecifier.text) == -1)
                        importModules.push(node.moduleSpecifier.text);
                });
            }
        }
    });
    tsSourceFile = doRename(tsSourceFile, renameInfos);
    tsSourceFile = updateTsSourceFileFromText(tsSourceFile);
    if (isExportModule) {
        var elements_1 = [];
        for (var i = 0; i < tsSourceFile.statements.length; i++) {
            var node = tsSourceFile.statements[i];
            if (node.modifiers && node.modifiers.find(function (m) { return m.kind == ts.SyntaxKind.ExportKeyword; })) {
                node.modifiers = node.modifiers.filter(function (m) { return m.kind != ts.SyntaxKind.ExportKeyword; });
                if (ts.isFunctionDeclaration(node) && node.name) {
                    var property = ts.createPropertyAssignment(node.name.escapedText.replace(getModuleFuncHeader(fileName), ""), ts.createIdentifier(node.name.escapedText));
                    elements_1.push(property);
                }
                else if (ts.isVariableStatement(node)) {
                    node.declarationList.declarations.forEach(function (declaration) {
                        var property = ts.createPropertyAssignment(declaration.name.escapedText.replace(getModuleFuncHeader(fileName), ""), ts.createIdentifier(declaration.name.escapedText));
                        elements_1.push(property);
                    });
                }
            }
        }
        var moduleExports = ts.createVariableStatement(undefined, ts.createVariableDeclarationList([ts.createVariableDeclaration(getModuleExportsName(fileName), undefined, ts.createObjectLiteral(elements_1, true))], ts.NodeFlags.None));
        tsSourceFile.statements.push(moduleExports);
    }
    tsSourceFile.forEachChild(function (node) {
        if (ts.isImportDeclaration(node)) {
            delete node.importClause;
        }
    });
    var js = ts.transpileModule(updateTsSourceFileFromData(tsSourceFile), { compilerOptions: tsConfig.options }).outputText;
    var newLine = ts.getNewLineCharacter(tsConfig.options);
    js = js.replace('Object.defineProperty(exports, "__esModule", { value: true });' + newLine, "");
    importModules.forEach(function (moduleName) {
        var exportName = getModuleExportsName(moduleName);
        var header = getModuleFuncHeader(moduleName);
        js = js.replace(new RegExp(exportName + "." + header, "g"), exportName + ".");
    });
    var output = services.getEmitOutput(filePath);
    output.outputFiles.forEach(function (o) {
        mkdirp.sync(path.dirname(o.name));
        fs.writeFileSync(o.name, js, encoding);
    });
}
var tsConfig = getTsConfig();
var services = getLanguageService(tsConfig);
tsConfig.fileNames.forEach(function (file) {
    buildFile(tsConfig, services, file);
});
