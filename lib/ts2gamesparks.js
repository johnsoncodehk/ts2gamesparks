"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var ts = require("typescript");
var fs = require("fs");
var path = require("path");
var mkdirp = require("mkdirp");
var encoding = "utf8";
var moduleFuncHeader = "module_{module_name}_";
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
    function getModuleFuncHead(name) {
        return moduleFuncHeader.replace("{module_name}", name);
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
    var isExportModule = false;
    tsSourceFile.forEachChild(function (node) {
        if (node.modifiers && !!node.modifiers.find(function (m) { return m.kind == ts.SyntaxKind.ExportKeyword; })) {
            isExportModule = true;
        }
    });
    var renameInfos = [];
    var importModules = [];
    if (isExportModule) {
        tsSourceFile.forEachChild(function (node) {
            if (ts.isFunctionDeclaration(node) && node.name) {
                var newName = getModuleFuncHead(fileName) + node.name.escapedText;
                renameInfos = renameInfos.concat(getRenameInfo(services, filePath, node.name.end, newName));
            }
            if (ts.isVariableStatement(node)) {
                node.declarationList.declarations.forEach(function (declaration) {
                    var declarationAny = declaration;
                    var newName = getModuleFuncHead(fileName) + declarationAny.name.escapedText;
                    renameInfos = renameInfos.concat(getRenameInfo(services, filePath, declaration.name.end, newName));
                });
            }
        });
    }
    var removeDotStr = "_REMOVE_NEXT_DOT_";
    tsSourceFile.forEachChild(function (node) {
        if (ts.isImportDeclaration(node)) {
            var nodeAny = node;
            if (nodeAny.importClause.namedBindings.name) {
                var namedBindings = node.importClause.namedBindings;
                renameInfos = renameInfos.concat(getRenameInfo(services, filePath, namedBindings.name.end, (nodeAny.moduleSpecifier.text != fileName ? getModuleFuncHead(nodeAny.moduleSpecifier.text) : "") + removeDotStr));
                if (importModules.indexOf(nodeAny.moduleSpecifier.text) == -1)
                    importModules.push(nodeAny.moduleSpecifier.text);
            }
        }
    });
    tsSourceFile.forEachChild(function (node) {
        if (ts.isImportDeclaration(node)) {
            var nodeAny_1 = node;
            if (nodeAny_1.importClause.namedBindings.elements) {
                var namedBindings = node.importClause.namedBindings;
                namedBindings.elements.forEach(function (element) {
                    var funcName = element.propertyName ? element.propertyName.escapedText : element.name.escapedText;
                    var funcHeader = nodeAny_1.moduleSpecifier.text != fileName ? getModuleFuncHead(nodeAny_1.moduleSpecifier.text) : "";
                    renameInfos = renameInfos.concat(getRenameInfo(services, filePath, element.name.end, funcHeader + funcName));
                    if (importModules.indexOf(nodeAny_1.moduleSpecifier.text) == -1)
                        importModules.push(nodeAny_1.moduleSpecifier.text);
                });
            }
        }
    });
    tsSourceFile = doRename(tsSourceFile, renameInfos);
    tsSourceFile.text = tsSourceFile.text.replace(new RegExp(removeDotStr + ".", "g"), "");
    tsSourceFile = updateTsSourceFileFromText(tsSourceFile);
    if (isExportModule) {
        tsSourceFile.forEachChild(function (node) {
            if (node.modifiers) {
                var exportIndex = node.modifiers.findIndex(function (m) { return m.kind == ts.SyntaxKind.ExportKeyword; });
                if (exportIndex >= 0) {
                    delete node.modifiers;
                }
            }
        });
    }
    tsSourceFile.forEachChild(function (node) {
        if (ts.isImportDeclaration(node)) {
            delete node.importClause;
        }
    });
    var js = ts.transpileModule(updateTsSourceFileFromData(tsSourceFile), { compilerOptions: tsConfig.options }).outputText;
    var newLine = ts.getNewLineCharacter(tsConfig.options);
    js = js.replace('Object.defineProperty(exports, "__esModule", { value: true });' + newLine, "");
    importModules.forEach(function (im) {
        var header = getModuleFuncHead(im);
        js = js.replace(new RegExp(header + header, "g"), header);
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
