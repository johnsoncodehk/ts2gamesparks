import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import * as mkdirp from "mkdirp";

const encoding = "utf8";
const moduleFuncHeader = "module_{module_name}_";

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
	function getModuleFuncHead(name: string) {
		return moduleFuncHeader.replace("{module_name}", name);
	}
	function updateTsSourceFileFromData(tsSourceFile: ts.SourceFile) {
		return ts.createPrinter().printFile(tsSourceFile);
	}
	function updateTsSourceFileFromText(tsSourceFile: ts.SourceFile) {
		return createSourceFile(tsSourceFile.fileName, tsSourceFile.text, tsSourceFile.languageVersion);
	}
	function getRenameInfo(services: ts.LanguageService, filePath: string, startPos: number, newName: string) {
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

	let fileName = path.basename(filePath, ".ts");
	let sourceCode = fs.readFileSync(filePath, encoding);
	let tsSourceFile = createSourceFile(filePath, sourceCode, tsConfig.options.target);

	/**
	 * String Edit
	 */

	// Check export module
	let isExportModule = false;
	tsSourceFile.forEachChild(node => {
		if (node.modifiers && !!node.modifiers.find(m => m.kind == ts.SyntaxKind.ExportKeyword)) {
			isExportModule = true;
		}
	});
	let renameInfos: RenameInfo[] = [];
	let importModules: string[] = [];

	// export function func() { }
	// => export function module_specifier_func() { }
	// export let obj = { }
	// => export function module_specifier_obj() { }
	if (isExportModule) {
		tsSourceFile.forEachChild(node => {
			if (ts.isFunctionDeclaration(node) && node.name) {
				let newName = getModuleFuncHead(fileName) + node.name.escapedText;
				renameInfos = renameInfos.concat(getRenameInfo(services, filePath, node.name.end, newName));
			}
			if (ts.isVariableStatement(node)) {
				node.declarationList.declarations.forEach(declaration => {
					let declarationAny = declaration as any;
					var newName = getModuleFuncHead(fileName) + declarationAny.name.escapedText;
					renameInfos = renameInfos.concat(getRenameInfo(services, filePath, declaration.name.end, newName));
				});
			}
		});
	}

	// import * as MoudleA as "moduleA";
	// MoudleA.funcA();
	// => import * as module_moduleA__REMOVE_NEXT_DOT_ as "moduleA";
	// => module_moduleA__REMOVE_NEXT_DOT_.funcA();
	const removeDotStr = "_REMOVE_NEXT_DOT_";
	tsSourceFile.forEachChild(node => {
		if (ts.isImportDeclaration(node)) {
			let nodeAny = node as any;
			if (nodeAny.importClause.namedBindings.name) {
				let namedBindings = node.importClause.namedBindings as ts.NamespaceImport;
				renameInfos = renameInfos.concat(getRenameInfo(services, filePath, namedBindings.name.end, (nodeAny.moduleSpecifier.text != fileName ? getModuleFuncHead(nodeAny.moduleSpecifier.text) : "") + removeDotStr));

				if (importModules.indexOf(nodeAny.moduleSpecifier.text) == -1)
					importModules.push(nodeAny.moduleSpecifier.text);
			}
		}
	});

	// import { funcA } as "moduleA";
	// funcA();
	// => import { module_moduleA_funcA } as "moduleA";
	// => module_moduleA_funcA();
	tsSourceFile.forEachChild(node => {
		if (ts.isImportDeclaration(node)) {
			let nodeAny = node as any;
			if (nodeAny.importClause.namedBindings.elements) {
				let namedBindings = node.importClause.namedBindings as ts.NamedImports;
				namedBindings.elements.forEach(element => {
					let funcName = element.propertyName ? element.propertyName.escapedText : element.name.escapedText;
					let funcHeader = nodeAny.moduleSpecifier.text != fileName ? getModuleFuncHead(nodeAny.moduleSpecifier.text) : "";
					renameInfos = renameInfos.concat(getRenameInfo(services, filePath, element.name.end, funcHeader + funcName));

					if (importModules.indexOf(nodeAny.moduleSpecifier.text) == -1)
						importModules.push(nodeAny.moduleSpecifier.text);
				});
			}
		}
	});

	// Do Rename
	tsSourceFile = doRename(tsSourceFile, renameInfos);

	// module_specifier___REMOVE_NEXT_DOT_.func();
	// => module_specifier_func();
	tsSourceFile.text = tsSourceFile.text.replace(new RegExp(removeDotStr + ".", "g"), "");

	// Save change
	tsSourceFile = updateTsSourceFileFromText(tsSourceFile);

	/**
	 * Object Edit
	 */

	// exports.func = func;
	// exports.obj = obj;
	// => **REMOVE**
	if (isExportModule) {
		tsSourceFile.forEachChild(node => {
			if (node.modifiers) {
				let exportIndex = node.modifiers.findIndex(m => m.kind == ts.SyntaxKind.ExportKeyword);
				if (exportIndex >= 0) {
					delete node.modifiers; // todo (Should not remove all modifiers)
				}
			}
		});
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

	// Fix with case:
	// import * as ModuleA from "moduleA";
	// import { funcA } from "moduleA";
	// ModuleA.funcA();
	// => module_moduleA_module_moduleA_funcA();
	importModules.forEach(im => {
		let header = getModuleFuncHead(im);
		js = js.replace(new RegExp(header + header, "g"), header);
	});

	/**
	 * Output
	 */
	let output = services.getEmitOutput(filePath);
	output.outputFiles.forEach(o => {
		mkdirp.sync(path.dirname(o.name));
		fs.writeFileSync(o.name, js, encoding);
	});
}

let tsConfig = getTsConfig();
let services = getLanguageService(tsConfig);
tsConfig.fileNames.forEach(file => {
	buildFile(tsConfig, services, file);
});
