"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var ts = require("typescript");
var fs = require("fs");
var path = require("path");
var mkdirp = require("mkdirp");
var assert = require("assert");
var encoding = "utf8";
var moduleKeyword = "module_";
var useRequireOnce = true;
function getTsConfig(cwd) {
    var file = ts.findConfigFile(cwd, ts.sys.fileExists);
    var config = ts.readJsonConfigFile(file, ts.sys.readFile);
    var content = ts.parseJsonSourceFileConfigFileContent(config, ts.sys, path.dirname(file));
    return content;
}
function getLanguageService(tsConfig, cwd) {
    var files = {};
    for (var _i = 0, _a = tsConfig.fileNames; _i < _a.length; _i++) {
        var fileName = _a[_i];
        files[fileName] = { version: 0 };
    }
    var servicesHost = {
        getScriptFileNames: function () { return tsConfig.fileNames; },
        getScriptVersion: function (fileName) { return files[fileName] && files[fileName].version.toString(); },
        getScriptSnapshot: function (fileName) {
            if (!fs.existsSync(fileName)) {
                return undefined;
            }
            return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName).toString());
        },
        getCurrentDirectory: function () { return cwd; },
        getCompilationSettings: function () { return tsConfig.options; },
        getDefaultLibFileName: function (options) { return ts.getDefaultLibFilePath(options); },
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
    };
    return ts.createLanguageService(servicesHost, ts.createDocumentRegistry());
}
function buildFile(tsConfig, services, fileName, cwd) {
    var sourceCode = fs.readFileSync(fileName, encoding);
    var tsSourceFile = ts.createSourceFile(fileName, sourceCode, tsConfig.options.target);
    var importModules = [];
    var identifiers = tsSourceFile.identifiers;
    for (var _i = 0, _a = Array.from(identifiers.values()); _i < _a.length; _i++) {
        var identifier = _a[_i];
        assert.notEqual(identifier.indexOf(moduleKeyword), 0, "\"" + identifier + "\" can't use, because \"" + moduleKeyword + "\" is reserved word.");
    }
    assert(!!tsConfig.options.baseUrl, "tsconfig.json: !baseUrl");
    var relativePath = path.relative(tsConfig.options.baseUrl, fileName);
    var isInModules = relativePath.indexOf("..") == -1;
    var moduleName = path.basename(isInModules ? replaceSeparator(relativePath) : fileName, ".ts");
    function replaceSeparator(name) {
        return name.replace(new RegExp("/", "g"), "__");
    }
    function isDeclaration(node) {
        return ts.isFunctionDeclaration(node) || ts.isEnumDeclaration(node) || ts.isClassDeclaration(node) || ts.isModuleDeclaration(node);
    }
    function getRenameInfo(endPosition, newName) {
        var result = services.findRenameLocations(fileName, endPosition, false, false);
        var renameLocation = result.find(function (r) { return r.fileName == fileName && (r.textSpan.start + r.textSpan.length + 1) == endPosition; });
        return {
            renameLocation: renameLocation,
            newName: newName,
        };
    }
    function getRenameInfos(endPosition, newName) {
        var result = services.findRenameLocations(fileName, endPosition, false, false);
        return result.filter(function (r) { return r.fileName == fileName; }).map(function (r) {
            return {
                renameLocation: r,
                newName: newName,
            };
        });
    }
    function doRenaming() {
        var renameInfos = [];
        function addPropertyRenameInfos(name) {
            if (name) {
                var newName = moduleKeyword + moduleName + "_" + name.escapedText;
                renameInfos = renameInfos.concat(getRenameInfos(name.end, newName));
            }
        }
        if (isInModules) {
            tsSourceFile.forEachChild(function (node) {
                if (isDeclaration(node)) {
                    addPropertyRenameInfos(node.name);
                }
                else if (ts.isVariableStatement(node)) {
                    for (var _i = 0, _a = node.declarationList.declarations; _i < _a.length; _i++) {
                        var declaration = _a[_i];
                        addPropertyRenameInfos(declaration.name);
                    }
                }
            });
        }
        tsSourceFile.forEachChild(function (node) {
            if (ts.isImportDeclaration(node)) {
                var namespaceImport = node.importClause.namedBindings;
                if (namespaceImport.name) {
                    var nodeModuleName = replaceSeparator(node.moduleSpecifier.text);
                    renameInfos = renameInfos.concat(getRenameInfos(namespaceImport.name.end, moduleKeyword + nodeModuleName));
                    renameInfos.push(getRenameInfo(node.moduleSpecifier.end, nodeModuleName));
                    if (importModules.indexOf(nodeModuleName) == -1)
                        importModules.push(nodeModuleName);
                }
            }
        });
        tsSourceFile.forEachChild(function (node) {
            if (ts.isImportDeclaration(node)) {
                var namedImports = node.importClause.namedBindings;
                if (namedImports.elements) {
                    var nodeModuleName = replaceSeparator(node.moduleSpecifier.text);
                    renameInfos.push(getRenameInfo(node.moduleSpecifier.end, nodeModuleName));
                    if (importModules.indexOf(nodeModuleName) == -1)
                        importModules.push(nodeModuleName);
                    for (var _i = 0, _a = namedImports.elements; _i < _a.length; _i++) {
                        var element = _a[_i];
                        var funcName = element.propertyName ? element.propertyName.escapedText : element.name.escapedText;
                        renameInfos = renameInfos.concat(getRenameInfos(element.name.end, moduleKeyword + nodeModuleName + "_" + funcName));
                    }
                }
            }
        });
        renameInfos = renameInfos.sort(function (a, b) { return b.renameLocation.textSpan.start - a.renameLocation.textSpan.start; });
        var newText = tsSourceFile.text;
        for (var _i = 0, renameInfos_1 = renameInfos; _i < renameInfos_1.length; _i++) {
            var info = renameInfos_1[_i];
            newText = newText.substr(0, info.renameLocation.textSpan.start) + info.newName + newText.substr(info.renameLocation.textSpan.start + info.renameLocation.textSpan.length);
        }
        tsSourceFile = ts.createSourceFile(tsSourceFile.fileName, newText, tsSourceFile.languageVersion);
    }
    function doRefactoring() {
        var properties = [];
        function addExportProperty(name) {
            if (name) {
                var internalName = name.escapedText;
                var exportName = internalName.substring((moduleKeyword + moduleName + "_").length);
                var property = ts.createPropertyAssignment(exportName, ts.createIdentifier(internalName));
                properties.push(property);
            }
        }
        if (isInModules) {
            for (var i = 0; i < tsSourceFile.statements.length; i++) {
                var node = tsSourceFile.statements[i];
                if (node.modifiers && node.modifiers.find(function (m) { return m.kind == ts.SyntaxKind.ExportKeyword; })) {
                    node.modifiers = node.modifiers.filter(function (m) { return m.kind != ts.SyntaxKind.ExportKeyword; });
                    if (isDeclaration(node)) {
                        addExportProperty(node.name);
                    }
                    else if (ts.isVariableStatement(node)) {
                        for (var _i = 0, _a = node.declarationList.declarations; _i < _a.length; _i++) {
                            var declaration = _a[_i];
                            addExportProperty(declaration.name);
                        }
                    }
                }
            }
            var moduleExports = ts.createVariableStatement(undefined, ts.createVariableDeclarationList([ts.createVariableDeclaration(moduleKeyword + moduleName, undefined, ts.createObjectLiteral(properties, true))], ts.NodeFlags.None));
            tsSourceFile.statements.push(moduleExports);
        }
        tsSourceFile.forEachChild(function (node) {
            if (ts.isImportDeclaration(node)) {
                delete node.importClause;
            }
        });
        if (useRequireOnce) {
            tsSourceFile.forEachChild(function (node) {
                if (ts.isImportDeclaration(node)) {
                    node.kind = ts.SyntaxKind.ExpressionStatement;
                    node.expression = ts.createCall(ts.createIdentifier("requireOnce"), undefined, [ts.createStringLiteral(node.moduleSpecifier.text)]);
                    delete node.moduleSpecifier;
                }
            });
        }
    }
    function doOutput() {
        var newLine = ts["getNewLineCharacter"](tsConfig.options);
        var js = ts.transpileModule(ts.createPrinter().printFile(tsSourceFile), { compilerOptions: tsConfig.options }).outputText;
        js = js.replace('Object.defineProperty(exports, "__esModule", { value: true });' + newLine, "");
        for (var _i = 0, importModules_1 = importModules; _i < importModules_1.length; _i++) {
            var importModule = importModules_1[_i];
            assert.equal(importModule.indexOf(".."), -1, "Relative path is not supported on Cloud Code.");
            js = js.replace(new RegExp(moduleKeyword + importModule + "." + moduleKeyword + importModule + "_", "g"), moduleKeyword + importModule + ".");
        }
        var output = services.getEmitOutput(fileName);
        for (var _a = 0, _b = output.outputFiles; _a < _b.length; _a++) {
            var o = _b[_a];
            var jsPath = o.name;
            if (isInModules) {
                var relativePathJs = relativePath.replace(".ts", ".js");
                jsPath = o.name.replace(relativePathJs, replaceSeparator(relativePathJs));
            }
            mkdirp.sync(path.dirname(jsPath));
            fs.writeFileSync(jsPath, js, encoding);
            console.log(path.relative(cwd, fileName) + " => " + path.relative(cwd, jsPath));
        }
    }
    var dirname = path.dirname(fileName).split("/").pop();
    if (dirname != "rtScript" && dirname != "rtModules") {
        doRenaming();
        doRefactoring();
    }
    doOutput();
}
function createBuilder(cwd) {
    var tsConfig = getTsConfig(cwd);
    var services = getLanguageService(tsConfig, cwd);
    function valid() {
        var diagnostics = services.getCompilerOptionsDiagnostics();
        assert(diagnostics.length == 0, diagnostics.length > 0 ? diagnostics[0].messageText.toString() : "");
        return diagnostics.length == 0;
    }
    function buildAllFiles() {
        if (!valid())
            return;
        for (var _i = 0, _a = tsConfig.fileNames; _i < _a.length; _i++) {
            var fileName = _a[_i];
            buildFile(tsConfig, services, fileName, cwd);
        }
    }
    function buildOneFile(fileName) {
        if (!valid())
            return;
        for (var _i = 0, _a = tsConfig.fileNames; _i < _a.length; _i++) {
            var fileName_2 = _a[_i];
            if (path.resolve(fileName) == path.resolve(fileName_2)) {
                buildFile(tsConfig, services, fileName_2, cwd);
                break;
            }
        }
    }
    return {
        buildAllFiles: buildAllFiles,
        buildFile: buildOneFile,
    };
}
exports.createBuilder = createBuilder;
function init(cwd) {
    var tsconfig = {
        "compilerOptions": {
            "target": "es5",
            "module": "commonjs",
            "lib": ["es5", "es2015"],
            "forceConsistentCasingInFileNames": true,
            "rootDir": "./",
            "outDir": "../dist/",
            "baseUrl": "./modules/"
        }
    };
    var tsconfig_rt = {
        "extends": "../tsconfig.json",
        "compilerOptions": {
            "baseUrl": "../rtModules/"
        }
    };
    function tryCreateFolder(folderName) {
        var folderPath = path.join(cwd, folderName);
        if (!fs.existsSync(folderPath))
            fs.mkdirSync(folderPath);
    }
    var tryWriteConfig = function (fileName, tsconfig) {
        var filePath = path.join(cwd, fileName);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify(tsconfig, undefined, 2));
        }
        else {
            console.log(filePath + " is already defined");
        }
    };
    console.log(ts.sys.getCurrentDirectory());
    tryWriteConfig("tsconfig.json", tsconfig);
    tryCreateFolder("rtModules");
    tryWriteConfig("rtModules/tsconfig.json", tsconfig_rt);
    tryCreateFolder("rtScript");
    tryWriteConfig("rtScript/tsconfig.json", tsconfig_rt);
}
exports.init = init;
