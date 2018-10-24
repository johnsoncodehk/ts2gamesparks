import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import * as mkdirp from "mkdirp";
import * as assert from "assert";

const encoding = "utf8";
const moduleKeyword = "module_";

function getTsConfig() {
	let file = ts.findConfigFile(process.cwd(), ts.sys.fileExists) as string;
	let config = ts.readJsonConfigFile(file, ts.sys.readFile);
	let content = ts.parseJsonSourceFileConfigFileContent(config, ts.sys, path.dirname(file));
	return content;
}
function getLanguageService(tsConfig: ts.ParsedCommandLine) {
	const files: ts.MapLike<{ version: number }> = {};

	// initialize the list of files
	tsConfig.fileNames.forEach(fileName => {
		files[fileName] = { version: 0 };
	});

	// Create the language service host to allow the LS to communicate with the host
	const servicesHost: ts.LanguageServiceHost = {
		getScriptFileNames: () => tsConfig.fileNames,
		getScriptVersion: (fileName) => files[fileName] && files[fileName].version.toString(),
		getScriptSnapshot: (fileName) => {
			if (!fs.existsSync(fileName)) {
				return undefined;
			}

			return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName).toString());
		},
		getCurrentDirectory: () => process.cwd(),
		getCompilationSettings: () => tsConfig.options,
		getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
		fileExists: ts.sys.fileExists,
		readFile: ts.sys.readFile,
		readDirectory: ts.sys.readDirectory,
	};

	// Create the language service files
	return ts.createLanguageService(servicesHost, ts.createDocumentRegistry());
}
function buildFile(tsConfig: ts.ParsedCommandLine, services: ts.LanguageService, filePath: string) {

	interface RenameInfo {
		renameLocation: ts.RenameLocation,
		newName: string,
	}

	function createSourceFile(filePath: string, sourceCode: string, scriptTarget: ts.ScriptTarget) {
		return ts.createSourceFile(
			filePath,
			sourceCode,
			scriptTarget
		);
	}
	// moduleA => module_moduleA
	// folder/moduleA => module_folder__moduleA
	function getModuleExportsName(name: string) {
		return moduleKeyword + name.replace(new RegExp("/", "g"), "__");
	}
	// moduleA => module_moduleA_
	function getModuleFuncHeader(name: string) {
		return getModuleExportsName(name) + "_";
	}
	function updateTsSourceFileFromData(tsSourceFile: ts.SourceFile) {
		return ts.createPrinter().printFile(tsSourceFile);
	}
	function updateTsSourceFileFromText(tsSourceFile: ts.SourceFile) {
		return createSourceFile(tsSourceFile.fileName, tsSourceFile.text, tsSourceFile.languageVersion);
	}
	function isDeclaration(node: ts.Node): node is ts.DeclarationStatement {
		return ts.isFunctionDeclaration(node) || ts.isEnumDeclaration(node) || ts.isClassDeclaration(node) || ts.isModuleDeclaration(node);
	}
	function getRenameInfos(services: ts.LanguageService, filePath: string, startPos: number, newName: string) {
		let result = services.findRenameLocations(filePath, startPos, false, false);
		return result.filter(r => r.fileName == filePath).map<RenameInfo>(r => {
			return {
				renameLocation: r,
				newName: newName,
			}
		});
	}
	function doRename(tsSourceFile: ts.SourceFile, infos: RenameInfo[]) {
		infos = infos.sort((a, b) => { return b.renameLocation.textSpan.start - a.renameLocation.textSpan.start; });
		for (let info of infos) {
			let text = tsSourceFile.text;
			text = text.substr(0, info.renameLocation.textSpan.start) + info.newName + text.substr(info.renameLocation.textSpan.start + info.renameLocation.textSpan.length);
			tsSourceFile.text = text;
		}
		return updateTsSourceFileFromText(tsSourceFile);
	}

	let sourceCode = fs.readFileSync(filePath, encoding);
	let tsSourceFile = createSourceFile(filePath, sourceCode, tsConfig.options.target);

	// @ts-ignore
	let identifiers = tsSourceFile.identifiers as Map<string, string>;
	identifiers.forEach(identifier => {
		assert.notEqual(identifier.indexOf(moduleKeyword), 0, "\"{identifier}\" can't use, because \"{keyword}\" is reserved word.".replace("{keyword}", moduleKeyword).replace("{identifier}", identifier));
	});

	/**
	 * Renaming
	 */

	let fileName = path.basename(filePath, ".ts"); // "moduleA" | "folder__moduleA"
	let isInModules = false; // in "modules/"

	assert(!!tsConfig.options.baseUrl, "tsconfig.json !baseUrl");
	let relativePath = path.relative(tsConfig.options.baseUrl, filePath); // ../event/fileA.ts | moduleA.ts | folder/moduleB.ts
	if (relativePath.indexOf("..") == -1) {
		isInModules = true;
		fileName = path.basename(relativePath.replace(new RegExp("/", "g"), "__"), ".ts");
	}

	let renameInfos: RenameInfo[] = [];
	let importModules: string[] = [];

	function addPropertyRenameInfos(name: ts.Identifier) {
		if (name) {
			let newName = getModuleFuncHeader(fileName) + name.escapedText;
			renameInfos = renameInfos.concat(getRenameInfos(services, filePath, name.end, newName));
		}
	}

	// export function func() { }
	// => export function module_moduleA_func() { }
	// export let obj = { }
	// => export let module_moduleA_obj = { }
	if (isInModules) {
		tsSourceFile.forEachChild(node => {
			if (isDeclaration(node)) {
				addPropertyRenameInfos(node.name as ts.Identifier);
			}
			else if (ts.isVariableStatement(node)) {
				node.declarationList.declarations.forEach(declaration => {
					addPropertyRenameInfos(declaration.name as ts.Identifier);
				});
			}
		});
	}

	// import * as MoudleA as "moduleA";
	// MoudleA.funcA();
	// => import * as module_moduleA as "moduleA";
	// => module_moduleA.funcA();
	tsSourceFile.forEachChild(node => {
		if (ts.isImportDeclaration(node)) {
			// @ts-ignore
			if (node.importClause.namedBindings.name) {
				let namedBindings = node.importClause.namedBindings as ts.NamespaceImport;
				// @ts-ignore
				renameInfos = renameInfos.concat(getRenameInfos(services, filePath, namedBindings.name.end, getModuleExportsName(node.moduleSpecifier.text)));

				// @ts-ignore
				let moduleName = node.moduleSpecifier.text;
				moduleName = moduleName.replace(new RegExp("/", "g"), "__");
				if (importModules.indexOf(moduleName) == -1)
					importModules.push(moduleName);

				renameInfos = renameInfos.concat(getRenameInfos(services, filePath, node.moduleSpecifier.end, moduleName));
			}
		}
	});

	// import { funcA } as "moduleA";
	// funcA();
	// => import { module_moduleA_funcA } as "moduleA";
	// => module_moduleA_funcA();
	tsSourceFile.forEachChild(node => {
		if (ts.isImportDeclaration(node)) {
			// @ts-ignore
			if (node.importClause.namedBindings.elements) {
				let namedBindings = node.importClause.namedBindings as ts.NamedImports;
				namedBindings.elements.forEach(element => {
					let funcName = element.propertyName ? element.propertyName.escapedText : element.name.escapedText;
					// @ts-ignore
					let funcHeader = getModuleFuncHeader(node.moduleSpecifier.text);
					renameInfos = renameInfos.concat(getRenameInfos(services, filePath, element.name.end, funcHeader + funcName));

					// @ts-ignore
					let moduleName = node.moduleSpecifier.text;
					moduleName = moduleName.replace(new RegExp("/", "g"), "__");
					if (importModules.indexOf(moduleName) == -1)
						importModules.push(moduleName);

					renameInfos = renameInfos.concat(getRenameInfos(services, filePath, node.moduleSpecifier.end, moduleName));
				});
			}
		}
	});

	// Do Rename
	tsSourceFile = doRename(tsSourceFile, renameInfos);

	// Save change
	tsSourceFile = updateTsSourceFileFromText(tsSourceFile);

	/**
	 * Object Edit
	 */

	// exports.func = func;
	// exports.obj = obj;
	// => var module_main = {
	//   func: module_moduleA_func,
	//   obj: module_moduleA_obj
	// };
	let properties: ts.ObjectLiteralElementLike[] = [];

	function addExportProperty(fileName: string, name: ts.Identifier) {
		if (name) {
			let internalName = name.escapedText as string;
			let exportName = internalName.substring(getModuleFuncHeader(fileName).length);
			let property = ts.createPropertyAssignment(exportName, ts.createIdentifier(internalName))
			properties.push(property);
		}
	}
	if (isInModules) {
		for (let i = 0; i < tsSourceFile.statements.length; i++) {
			let node = tsSourceFile.statements[i];
			if (node.modifiers && node.modifiers.find(m => m.kind == ts.SyntaxKind.ExportKeyword)) {
				// @ts-ignore
				node.modifiers = node.modifiers.filter(m => m.kind != ts.SyntaxKind.ExportKeyword);
				if (isDeclaration(node)) {
					addExportProperty(fileName, node.name as ts.Identifier);
				}
				else if (ts.isVariableStatement(node)) {
					node.declarationList.declarations.forEach(declaration => {
						addExportProperty(fileName, declaration.name as ts.Identifier);
					});
				}
			}
		}
		let moduleExports = ts.createVariableStatement(
			undefined,
			ts.createVariableDeclarationList(
				[ts.createVariableDeclaration(getModuleExportsName(fileName), undefined, ts.createObjectLiteral(properties, true))],
				ts.NodeFlags.None,
			),
		);
		// @ts-ignore
		tsSourceFile.statements.push(moduleExports);
	}

	// var Module = require("module")
	// => require("module");
	tsSourceFile.forEachChild(node => {
		if (ts.isImportDeclaration(node)) {
			delete node.importClause;
		}
	});

	/**
	 * Output JS Edit
	 */
	let js = ts.transpileModule(updateTsSourceFileFromData(tsSourceFile), { compilerOptions: tsConfig.options }).outputText;
	let newLine = (ts as any).getNewLineCharacter(tsConfig.options);
	js = js.replace('Object.defineProperty(exports, "__esModule", { value: true });' + newLine, "");

	// Fix with case import self:
	// import * as ModuleA from "moduleA";
	// export funcA() { }
	// ModuleA.funcA();
	// => module_moduleA.module_moduleA_funcA();
	// Fix: module_moduleA.funcA();
	importModules.forEach(moduleName => {
		assert.equal(moduleName.indexOf(".."), -1, "Relative path is not supported on Cloud Code, please change to file name: " + moduleName);

		let exportName = getModuleExportsName(moduleName);
		let header = getModuleFuncHeader(moduleName);
		js = js.replace(new RegExp(exportName + "." + header, "g"), exportName + ".");
	});

	/**
	 * Output
	 */
	let output = services.getEmitOutput(filePath);
	output.outputFiles.forEach(o => {
		let jsPath = o.name;
		if (isInModules) {
			let relativePathJs = relativePath.replace(".ts", ".js");
			let relativePathJs_2 = relativePathJs.replace(new RegExp("/", "g"), "__");
			jsPath = o.name.replace(relativePathJs, relativePathJs_2);
		}
		mkdirp.sync(path.dirname(jsPath));
		fs.writeFileSync(jsPath, js, encoding);
	});
}

let tsConfig = getTsConfig();
let services = getLanguageService(tsConfig);

let diagnostics = services.getCompilerOptionsDiagnostics();
assert(diagnostics.length == 0, diagnostics.length > 0 ? diagnostics[0].messageText.toString() : "");

tsConfig.fileNames.forEach(file => {
	buildFile(tsConfig, services, file);
});
