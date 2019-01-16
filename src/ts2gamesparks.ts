import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import * as mkdirp from "mkdirp";
import * as assert from "assert";

const encoding = "utf8";
const moduleKeyword = "module_";

function getTsConfig() {
	const file = ts.findConfigFile(process.cwd(), ts.sys.fileExists) as string;
	const config = ts.readJsonConfigFile(file, ts.sys.readFile);
	const content = ts.parseJsonSourceFileConfigFileContent(config, ts.sys, path.dirname(file));
	return content;
}
function getLanguageService(tsConfig: ts.ParsedCommandLine) {
	const files: ts.MapLike<{ version: number }> = {};

	// initialize the list of files
	for (const fileName of tsConfig.fileNames) {
		files[fileName] = { version: 0 };
	}

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
function buildFile(tsConfig: ts.ParsedCommandLine, services: ts.LanguageService, fileName: string) {

	const sourceCode = fs.readFileSync(fileName, encoding);
	let tsSourceFile = ts.createSourceFile(fileName, sourceCode, tsConfig.options.target);
	const importModules: string[] = [];

	// @ts-ignore
	const identifiers = tsSourceFile.identifiers as Map<string, string>;
	for (const identifier of Array.from(identifiers.values())) {
		assert.notEqual(identifier.indexOf(moduleKeyword), 0, `"${identifier}" can't use, because "${moduleKeyword}" is reserved word.`);
	}

	assert(!!tsConfig.options.baseUrl, "tsconfig.json: !baseUrl");
	const relativePath = path.relative(tsConfig.options.baseUrl, fileName); // ../event/eventA.ts | moduleA.ts | folder/moduleB.ts
	const isInModules = relativePath.indexOf("modules/") == 0 || relativePath.indexOf("rtModules/") == 0; // in "modules/" or in rtModules/
	const moduleName = path.basename(isInModules ? replaceSeparator(relativePath.replace(/^(rtM|m)odules\//, "")) : fileName, ".ts"); // "moduleA" | "folder__moduleB" | "eventA" | "eventB"

	interface RenameInfo {
		renameLocation: ts.RenameLocation,
		newName: string,
	}

	/**
	 * @example
	 * // before
	 * "folder/moduleA"
	 * // after
	 * "folder__moduleA"
	 */
	function replaceSeparator(name: string) {
		return name.replace(new RegExp("/", "g"), "__");
	}
	function isDeclaration(node: ts.Node): node is ts.DeclarationStatement {
		return ts.isFunctionDeclaration(node) || ts.isEnumDeclaration(node) || ts.isClassDeclaration(node) || ts.isModuleDeclaration(node);
	}
	function getRenameInfo(endPosition: number, newName: string): RenameInfo {
		const result = services.findRenameLocations(fileName, endPosition, false, false);
		const renameLocation = result.find(r => r.fileName == fileName && (r.textSpan.start + r.textSpan.length + 1) == endPosition);
		return {
			renameLocation: renameLocation,
			newName: newName,
		};
	}
	function getRenameInfos(endPosition: number, newName: string) {
		const result = services.findRenameLocations(fileName, endPosition, false, false);
		return result.filter(r => r.fileName == fileName).map<RenameInfo>(r => {
			return {
				renameLocation: r,
				newName: newName,
			}
		});
	}
	function doRenaming() {

		let renameInfos: RenameInfo[] = [];

		/**
		 * @example
		 * // before
		 * export function func() { }
		 * export const obj = { }
	 	 * // after
		 * export function module_moduleA_func() { }
		 * export const module_moduleA_obj = { }
		 */
		function addPropertyRenameInfos(name: ts.Identifier) {
			if (name) {
				const newName = moduleKeyword + moduleName + "_" + name.escapedText;
				renameInfos = renameInfos.concat(getRenameInfos(name.end, newName));
			}
		}
		if (isInModules) {
			tsSourceFile.forEachChild(node => {
				if (isDeclaration(node)) {
					addPropertyRenameInfos(node.name as ts.Identifier);
				}
				else if (ts.isVariableStatement(node)) {
					for (const declaration of node.declarationList.declarations) {
						addPropertyRenameInfos(declaration.name as ts.Identifier);
					}
				}
			});
		}

		/**
		 * @example
		 * // before
		 * import * as MoudleA as "moduleA";
		 * MoudleA.funcA();
		 * // after
		 * import * as module_moduleA as "moduleA";
		 * module_moduleA.funcA();
		 */
		tsSourceFile.forEachChild(node => {
			if (ts.isImportDeclaration(node)) {
				const namespaceImport = node.importClause.namedBindings as ts.NamespaceImport;
				if (namespaceImport.name) {
					// @ts-ignore
					const nodeModuleName = replaceSeparator(node.moduleSpecifier.text);

					renameInfos = renameInfos.concat(getRenameInfos(namespaceImport.name.end, moduleKeyword + nodeModuleName));
					renameInfos.push(getRenameInfo(node.moduleSpecifier.end, nodeModuleName));

					if (importModules.indexOf(nodeModuleName) == -1)
						importModules.push(nodeModuleName);
				}
			}
		});

		/**
		 * @example
		 * // before
		 * import { funcA } as "moduleA";
		 * funcA();
		 * // after
		 * import { module_moduleA_funcA } as "moduleA";
		 * module_moduleA_funcA();
		 */
		tsSourceFile.forEachChild(node => {
			if (ts.isImportDeclaration(node)) {
				const namedImports = node.importClause.namedBindings as ts.NamedImports;
				if (namedImports.elements) {
					for (const element of namedImports.elements) {
						// @ts-ignore
						const nodeModuleName = replaceSeparator(node.moduleSpecifier.text);
						const funcName = element.propertyName ? element.propertyName.escapedText : element.name.escapedText;

						renameInfos = renameInfos.concat(getRenameInfos(element.name.end, moduleKeyword + nodeModuleName + "_" + funcName));
						renameInfos.push(getRenameInfo(node.moduleSpecifier.end, nodeModuleName));

						if (importModules.indexOf(nodeModuleName) == -1)
							importModules.push(nodeModuleName);
					}
				}
			}
		});

		/**
		 * Apply
		 */
		renameInfos = renameInfos.sort((a, b) => { return b.renameLocation.textSpan.start - a.renameLocation.textSpan.start; });
		let newText = tsSourceFile.text;
		for (const info of renameInfos) {
			newText = newText.substr(0, info.renameLocation.textSpan.start) + info.newName + newText.substr(info.renameLocation.textSpan.start + info.renameLocation.textSpan.length);
		}
		tsSourceFile = ts.createSourceFile(tsSourceFile.fileName, newText, tsSourceFile.languageVersion);
	}
	function doRefactoring() {
		/**
		 * @example
		 * // before
		 * exports.foo = foo;
		 * exports.bar = bar;
		 * // after
		 * var module_main = {
		 *   foo: module_moduleA_foo,
		 *   bar: module_moduleA_bar
		 * };
		 */
		const properties: ts.ObjectLiteralElementLike[] = [];

		function addExportProperty(name: ts.Identifier) {
			if (name) {
				const internalName = name.escapedText as string;
				const exportName = internalName.substring((moduleKeyword + moduleName + "_").length);
				const property = ts.createPropertyAssignment(exportName, ts.createIdentifier(internalName))
				properties.push(property);
			}
		}
		if (isInModules) {
			for (let i = 0; i < tsSourceFile.statements.length; i++) {
				const node = tsSourceFile.statements[i];
				if (node.modifiers && node.modifiers.find(m => m.kind == ts.SyntaxKind.ExportKeyword)) {
					// @ts-ignore
					node.modifiers = node.modifiers.filter(m => m.kind != ts.SyntaxKind.ExportKeyword);
					if (isDeclaration(node)) {
						addExportProperty(node.name as ts.Identifier);
					}
					else if (ts.isVariableStatement(node)) {
						for (const declaration of node.declarationList.declarations) {
							addExportProperty(declaration.name as ts.Identifier);
						}
					}
				}
			}
			const moduleExports = ts.createVariableStatement(
				undefined,
				ts.createVariableDeclarationList(
					[ts.createVariableDeclaration(moduleKeyword + moduleName, undefined, ts.createObjectLiteral(properties, true))],
					ts.NodeFlags.None,
				),
			);
			// @ts-ignore
			tsSourceFile.statements.push(moduleExports);
		}

		/**
		 * @example
		 * // before
		 * var Module = require("module")
		 * // after
		 * require("module");
		 */
		tsSourceFile.forEachChild(node => {
			if (ts.isImportDeclaration(node)) {
				delete node.importClause;
			}
		});
	}
	function doOutput() {
		/**
		 * Remove "__esModule"
		 */
		const newLine = ts["getNewLineCharacter"](tsConfig.options);
		let js = ts.transpileModule(ts.createPrinter().printFile(tsSourceFile), { compilerOptions: tsConfig.options }).outputText;
		js = js.replace('Object.defineProperty(exports, "__esModule", { value: true });' + newLine, "");

		/**
		 * Fix import self
		 * 
		 * @example
		 * // moduleA.ts
		 * import * as ModuleA from "moduleA";
		 * export funcA() { }
		 * ModuleA.funcA();
		 * // moduleA.js
		 * ...
		 * module_moduleA.module_moduleA_funcA();
		 * // fix moduleA.js
		 * ...
		 * module_moduleA.funcA();
		 */
		for (const importModule of importModules) {
			assert.equal(importModule.indexOf(".."), -1, "Relative path is not supported on Cloud Code.");

			js = js.replace(new RegExp(moduleKeyword + importModule + "." + moduleKeyword + importModule + "_", "g"), moduleKeyword + importModule + ".");
		}

		/**
		 * Output
		 */
		const output = services.getEmitOutput(fileName);
		for (const o of output.outputFiles) {
			let jsPath = o.name;
			if (isInModules) {
				/**
				 * @example
				 * // before
				 * "dict/modules/folder/moduleA.js"
				 * // after
				 * "dict/modules/folder__moduleA.js"
				 */
				const relativePathJs = relativePath.replace(/^(rtM|m)odules\//, "").replace(".ts", ".js");
				jsPath = o.name.replace(relativePathJs, replaceSeparator(relativePathJs));
			}
			mkdirp.sync(path.dirname(jsPath));
			fs.writeFileSync(jsPath, js, encoding);
			console.log(path.relative(process.cwd(), fileName) + " => " + path.relative(process.cwd(), jsPath))
		}
	}

	doRenaming();
	doRefactoring();
	doOutput();
}

const tsConfig = getTsConfig();
const services = getLanguageService(tsConfig);

const diagnostics = services.getCompilerOptionsDiagnostics();
assert(diagnostics.length == 0, diagnostics.length > 0 ? diagnostics[0].messageText.toString() : "");

for (const fileName of tsConfig.fileNames) {
	buildFile(tsConfig, services, fileName);
}
