"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var ts = require("typescript");
var fs = require("fs-extra");
var path = require("path");
var ts_extra_1 = require("./ts-extra");
function createBuilder(dir, options) {
    if (options === void 0) { options = {}; }
    return new Builder(dir, options);
}
exports.createBuilder = createBuilder;
var defaultOptions = {
    encoding: "utf8",
    useRequireOnce: true,
};
var Builder = (function () {
    function Builder(dir, options) {
        if (options === void 0) { options = {}; }
        this.dir = dir;
        this.options = options;
        this.tsConfig = ts_extra_1.getTsConfig(dir);
        this.services = ts_extra_1.getLanguageService(this.tsConfig, dir);
    }
    Builder.prototype.buildAllFiles = function () {
        for (var _i = 0, _a = this.tsConfig.fileNames; _i < _a.length; _i++) {
            var fileName = _a[_i];
            emit(this.dir, this.options, this.tsConfig, this.services, fileName);
        }
    };
    Builder.prototype.buildFile = function (fileName) {
        for (var _i = 0, _a = this.tsConfig.fileNames; _i < _a.length; _i++) {
            var fileName_2 = _a[_i];
            if (path.resolve(fileName) == path.resolve(fileName_2)) {
                emit(this.dir, this.options, this.tsConfig, this.services, fileName_2);
                return;
            }
        }
        throw "file not find in array: " + JSON.stringify(this.tsConfig.fileNames, undefined, 4);
    };
    Builder.prototype.buildJs = function (fileName) {
        for (var _i = 0, _a = this.tsConfig.fileNames; _i < _a.length; _i++) {
            var fileName_2 = _a[_i];
            if (path.resolve(fileName) == path.resolve(fileName_2)) {
                return convert(this.dir, this.options, this.tsConfig, this.services, fileName_2);
            }
        }
        throw "file not find in array: " + JSON.stringify(this.tsConfig.fileNames, undefined, 4);
    };
    return Builder;
}());
function emit(dir, options, tsConfig, services, fileName) {
    var js = convert(dir, options, tsConfig, services, fileName);
    var output = services.getEmitOutput(fileName);
    for (var _i = 0, _a = output.outputFiles; _i < _a.length; _i++) {
        var o = _a[_i];
        var paths = path.relative(dir, fileName).replace(".ts", ".js").split("/");
        paths.shift();
        var jsFileName = paths.join("/");
        var newJsFileName = paths.join("__");
        var jsPath = o.name.replace(jsFileName, newJsFileName);
        fs.mkdirpSync(path.dirname(jsPath));
        fs.writeFileSync(jsPath, js, options.encoding);
        console.log(path.relative(dir, fileName) + " => " + path.relative(dir, jsPath));
    }
}
function convert(dir, options, tsConfig, services, fileName) {
    for (var key in defaultOptions) {
        if (options[key] === undefined) {
            options[key] = defaultOptions[key];
        }
    }
    var sourceCode = fs.readFileSync(fileName, options.encoding);
    var sourceFile = ts.createSourceFile(fileName, sourceCode, tsConfig.options.target);
    var dirname = path.relative(dir, fileName).split("/").shift();
    if (dirname != "rtScript" && dirname != "rtModules") {
        sourceFile = renameImportModules(services, fileName, dir, sourceFile);
        convertImportToGamesparksRequire(sourceFile, options.useRequireOnce);
    }
    if (dirname == "modules") {
        warpIIFE(sourceFile, dir, fileName);
    }
    var js = ts.transpileModule(ts.createPrinter().printFile(sourceFile), { compilerOptions: tsConfig.options }).outputText;
    js = removeUnderscoreUnderscoreESModule(js, tsConfig);
    return js;
}
function renameImportModules(services, fileName, dir, sourceFile) {
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
    function getImportModuleName(importName) {
        var filePath = path.join(dir, "modules", importName);
        return path.basename(replaceSeparator(path.relative(dir, filePath)));
    }
    function getNamespaceImportRenameInfos() {
        var renameInfos = [];
        sourceFile.forEachChild(function (node) {
            if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
                var namespaceImport = node.importClause.namedBindings;
                if (namespaceImport.name) {
                    var importName = node.moduleSpecifier.text;
                    var newImportName = replaceSeparator(importName);
                    renameInfos = renameInfos.concat(getRenameInfos(namespaceImport.name.end, getImportModuleName(importName)));
                    renameInfos.push(getRenameInfo(node.moduleSpecifier.end, newImportName));
                }
            }
        });
        return renameInfos;
    }
    function getNamedImportsRenameInfos() {
        var renameInfos = [];
        sourceFile.forEachChild(function (node) {
            if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
                var namedImports = node.importClause.namedBindings;
                if (namedImports.elements) {
                    var importName = node.moduleSpecifier.text;
                    var newImportName = replaceSeparator(importName);
                    renameInfos.push(getRenameInfo(node.moduleSpecifier.end, newImportName));
                    for (var _i = 0, _a = namedImports.elements; _i < _a.length; _i++) {
                        var element = _a[_i];
                        var funcName = element.propertyName ? element.propertyName.escapedText : element.name.escapedText;
                        renameInfos = renameInfos.concat(getRenameInfos(element.name.end, getImportModuleName(importName) + "." + funcName));
                    }
                }
            }
        });
        return renameInfos;
    }
    var renameInfos = [];
    renameInfos = renameInfos.concat(getNamespaceImportRenameInfos());
    renameInfos = renameInfos.concat(getNamedImportsRenameInfos());
    renameInfos = renameInfos.sort(function (a, b) { return b.renameLocation.textSpan.start - a.renameLocation.textSpan.start; });
    var newText = sourceFile.text;
    for (var _i = 0, renameInfos_1 = renameInfos; _i < renameInfos_1.length; _i++) {
        var info = renameInfos_1[_i];
        newText = newText.substr(0, info.renameLocation.textSpan.start) + info.newName + newText.substr(info.renameLocation.textSpan.start + info.renameLocation.textSpan.length);
    }
    return ts.createSourceFile(sourceFile.fileName, newText, sourceFile.languageVersion);
}
function convertImportToGamesparksRequire(sourceFile, useRequireOnce) {
    sourceFile.forEachChild(function (node) {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            node.kind = ts.SyntaxKind.ExpressionStatement;
            node.expression = ts.createCall(ts.createIdentifier(useRequireOnce ? "requireOnce" : "require"), undefined, [node.moduleSpecifier]);
        }
    });
}
function warpIIFE(sourceFile, dir, fileName) {
    function addExportProperty(name) {
        if (name) {
            var internalName = name.escapedText;
            var exportName = internalName;
            var property = ts.createPropertyAssignment(exportName, ts.createIdentifier(internalName));
            properties.push(property);
        }
    }
    function isDeclaration(node) {
        return ts.isFunctionDeclaration(node) || ts.isEnumDeclaration(node) || ts.isClassDeclaration(node) || ts.isModuleDeclaration(node);
    }
    var properties = [];
    for (var i = 0; i < sourceFile.statements.length; i++) {
        var node = sourceFile.statements[i];
        if (node.modifiers && node.modifiers.find(function (m) { return m.kind == ts.SyntaxKind.ExportKeyword; })) {
            node.modifiers = ts.createNodeArray(node.modifiers.filter(function (m) { return m.kind != ts.SyntaxKind.ExportKeyword; }));
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
    var funcReturn = ts.createReturn(ts.createObjectLiteral(properties, true));
    var funcBody = ts.createArrowFunction([], [], [], undefined, undefined, ts.createBlock(sourceFile.statements.concat([funcReturn])));
    var moduleName = path.basename(replaceSeparator(path.relative(dir, fileName)), ".ts");
    var callFuncDecl = ts.createVariableDeclaration(moduleName, undefined, ts.createCall(funcBody, [], []));
    var callFuncStat = ts.createVariableStatement([], [callFuncDecl]);
    sourceFile.statements = ts.createNodeArray([callFuncStat]);
}
function removeUnderscoreUnderscoreESModule(js, tsConfig) {
    var newLine = ts["getNewLineCharacter"](tsConfig.options);
    return js.replace('Object.defineProperty(exports, "__esModule", { value: true });' + newLine, "");
}
function replaceSeparator(name) {
    return name.replace(new RegExp("/", "g"), "__");
}
function init(dir) {
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
    function tryWriteConfig(fileName, tsconfig) {
        var filePath = path.join(dir, fileName);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify(tsconfig, undefined, 2));
        }
        else {
            console.log(filePath + " is already defined");
        }
    }
    fs.mkdirpSync(dir);
    tryWriteConfig("tsconfig.json", tsconfig);
    fs.mkdirpSync(path.join(dir, "rtModules"));
    tryWriteConfig("rtModules/tsconfig.json", tsconfig_rt);
    fs.mkdirpSync(path.join(dir, "rtScript"));
    tryWriteConfig("rtScript/tsconfig.json", tsconfig_rt);
}
exports.init = init;
