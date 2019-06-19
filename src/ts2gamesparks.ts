import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import * as mkdirp from "mkdirp";
import * as assert from "assert";

const encoding = "utf8";
const useRequireOnce = true;

function getTsConfig(cwd: string) {
	const file = ts.findConfigFile(cwd, ts.sys.fileExists) as string;
	const config = ts.readJsonConfigFile(file, ts.sys.readFile);
	const content = ts.parseJsonSourceFileConfigFileContent(config, ts.sys, path.dirname(file));
	return content;
}
function getLanguageService(tsConfig: ts.ParsedCommandLine, cwd: string) {
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
		getCurrentDirectory: () => cwd,
		getCompilationSettings: () => tsConfig.options,
		getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
		fileExists: ts.sys.fileExists,
		readFile: ts.sys.readFile,
		readDirectory: ts.sys.readDirectory,
	};

	// Create the language service files
	return ts.createLanguageService(servicesHost, ts.createDocumentRegistry());
}
function buildFile(tsConfig: ts.ParsedCommandLine, services: ts.LanguageService, fileName: string, cwd: string) {

	const sourceCode = fs.readFileSync(fileName, encoding);
	let tsSourceFile = ts.createSourceFile(fileName, sourceCode, tsConfig.options.target);
	const importModules: string[] = [];

	// @ts-ignore
	const identifiers = tsSourceFile.identifiers as Map<string, string>;
	for (const identifier of Array.from(identifiers.values())) {
		assert(identifier.indexOf("__") == -1, `"${identifier}" can't include '__'.`);
	}

	assert(!!tsConfig.options.baseUrl, "tsconfig.json: !baseUrl");
	const underModules = path.relative(tsConfig.options.baseUrl, fileName).indexOf("..") == -1; // file in "modules/" folder
	const moduleName = path.basename(replaceSeparator(path.relative(cwd, fileName)), ".ts"); // "modules__foo" | "modules__folder__bar"

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
		 * import * as MoudleA as "moduleA";
		 * MoudleA.funcA();
		 * // after
		 * import * as modules__moduleA as "moduleA";
		 * modules__moduleA.funcA();
		 */
		function getImportModuleName(importName: string) {
			const filePath = path.join(tsConfig.options.baseUrl, importName);
			return path.basename(replaceSeparator(path.relative(cwd, filePath)));
		}
		tsSourceFile.forEachChild(node => {
			if (ts.isImportDeclaration(node)) {
				const namespaceImport = node.importClause.namedBindings as ts.NamespaceImport;
				if (namespaceImport.name) {
					// @ts-ignore
					const importName = node.moduleSpecifier.text;
					const newImportName = replaceSeparator(importName);

					renameInfos = renameInfos.concat(getRenameInfos(namespaceImport.name.end, getImportModuleName(importName)));
					renameInfos.push(getRenameInfo(node.moduleSpecifier.end, newImportName));

					if (importModules.indexOf(newImportName) == -1)
						importModules.push(newImportName);
				}
			}
		});

		/**
		 * @example
		 * // before
		 * import { funcA } as "moduleA";
		 * funcA();
		 * // after
		 * import { modules__moduleA.funcA } as "moduleA";
		 * modules__moduleA.funcA();
		 */
		tsSourceFile.forEachChild(node => {
			if (ts.isImportDeclaration(node)) {
				const namedImports = node.importClause.namedBindings as ts.NamedImports;
				if (namedImports.elements) {
					// @ts-ignore
					const importName = node.moduleSpecifier.text;
					const newImportName = replaceSeparator(importName);
					renameInfos.push(getRenameInfo(node.moduleSpecifier.end, newImportName));

					if (importModules.indexOf(newImportName) == -1)
						importModules.push(newImportName);

					for (const element of namedImports.elements) {
						const funcName = element.propertyName ? element.propertyName.escapedText : element.name.escapedText;
						renameInfos = renameInfos.concat(getRenameInfos(element.name.end, getImportModuleName(importName) + "." + funcName));
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

		const properties: ts.ObjectLiteralElementLike[] = [];
		function addExportProperty(name: ts.Identifier) {
			if (name) {
				const internalName = name.escapedText as string;
				const exportName = internalName;
				const property = ts.createPropertyAssignment(exportName, ts.createIdentifier(internalName))
				properties.push(property);
			}
		}
		if (underModules) {
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

		if (useRequireOnce) {
			/**
			 * @example
			 * // before
			 * require("module");
			 * // after
			 * requireOnce("module");
			 */
			tsSourceFile.forEachChild(function (node) {
				if (ts.isImportDeclaration(node)) {
					// @ts-ignore
					node.kind = ts.SyntaxKind.ExpressionStatement;
					// @ts-ignore
					node.expression = ts.createCall(
						ts.createIdentifier("requireOnce"),
						undefined,
						// @ts-ignore
						[ts.createStringLiteral(node.moduleSpecifier.text)],
					);
					delete node.moduleSpecifier;
				}
			});
		}

		/**
		 * @example
		 * // before
		 * export const foo = "foo";
		 * export function bar() {
		 *     return "bar";
		 * }
		 * // after
		 * const modules__name = (function () {
		 *     const foo = "foo";
		 *     function bar() {
		 *         return "bar";
		 *     }
		 *     return {
		 *         foo: foo,
		 *         bar: bar
		 *     };
		 * })();
		 */
		if (underModules) {
			const funcReturn = ts.createReturn(ts.createObjectLiteral(properties, true));
			const funcBody = ts.createArrowFunction([], [], [], undefined, undefined, ts.createBlock([...tsSourceFile.statements, funcReturn]));

			const callFuncDecl = ts.createVariableDeclaration(moduleName, undefined, ts.createCall(funcBody, [], []))
			const callFuncStat = ts.createVariableStatement([], [callFuncDecl]);

			// @ts-ignore
			tsSourceFile.statements = [callFuncStat];
		}
	}
	function doOutput() {
		/**
		 * Remove "__esModule"
		 */
		const newLine = ts["getNewLineCharacter"](tsConfig.options);
		let js = ts.transpileModule(ts.createPrinter().printFile(tsSourceFile), { compilerOptions: tsConfig.options }).outputText;
		js = js.replace('Object.defineProperty(exports, "__esModule", { value: true });' + newLine, "");

		/**
		 * Output
		 */
		const output = services.getEmitOutput(fileName);
		for (const o of output.outputFiles) {

			/**
			 * @example
			 * // before
			 * "dict/modules/folder/moduleA.js"
			 * // after
			 * "dict/modules/folder__moduleA.js"
			 */
			const paths = path.relative(cwd, fileName).replace(".ts", ".js").split("/");
			paths.shift(); // remove first folder
			const jsFileName = paths.join("/");
			const newJsFileName = paths.join("__");
			let jsPath = o.name.replace(jsFileName, newJsFileName);

			mkdirp.sync(path.dirname(jsPath));
			fs.writeFileSync(jsPath, js, encoding);
			console.log(path.relative(cwd, fileName) + " => " + path.relative(cwd, jsPath))
		}
	}

	const dirname = path.dirname(fileName).split("/").pop();
	if (dirname != "rtScript" && dirname != "rtModules") {
		doRenaming();
		doRefactoring();
	}
	doOutput();
}
export function createBuilder(cwd: string) {
	const tsConfig = getTsConfig(cwd);
	const services = getLanguageService(tsConfig, cwd);

	function valid() {
		const diagnostics = services.getCompilerOptionsDiagnostics();
		assert(diagnostics.length == 0, diagnostics.length > 0 ? diagnostics[0].messageText.toString() : "");
	}
	function buildAllFiles() {
		valid();

		for (const fileName of tsConfig.fileNames) {
			buildFile(tsConfig, services, fileName, cwd);
		}
	}
	function buildOneFile(fileName: string) {
		valid();

		for (const fileName_2 of tsConfig.fileNames) {
			if (path.resolve(fileName) == path.resolve(fileName_2)) {
				buildFile(tsConfig, services, fileName_2, cwd);
				return;
			}
		}

		throw "file not find in array: " + JSON.stringify(tsConfig.fileNames, undefined, 4);
	}

	return {
		buildAllFiles: buildAllFiles,
		buildFile: buildOneFile,
	};
}
export function init(cwd: string) {
	const tsconfig = {
		"compilerOptions": {
			"target": "es5",
			"module": "commonjs",
			"lib": ["es5", "es2015"],
			"forceConsistentCasingInFileNames": true,
			"rootDir": "./",
			"outDir": "../dist/",
			"baseUrl": "./modules/"
		}
	}
	const tsconfig_rt = {
		"extends": "../tsconfig.json",
		"compilerOptions": {
			"baseUrl": "../rtModules/"
		}
	}

	function tryCreateFolder(folderName: string) {
		const folderPath = path.join(cwd, folderName);
		if (!fs.existsSync(folderPath))
			fs.mkdirSync(folderPath);
	}
	function tryWriteConfig(fileName: string, tsconfig: any) {
		const filePath = path.join(cwd, fileName);
		if (!fs.existsSync(filePath)) {
			fs.writeFileSync(filePath, JSON.stringify(tsconfig, undefined, 2));
		}
		else {
			console.log(filePath + " is already defined");
		}
	}

	console.log(ts.sys.getCurrentDirectory());
	tryWriteConfig("tsconfig.json", tsconfig);

	tryCreateFolder("rtModules")
	tryWriteConfig("rtModules/tsconfig.json", tsconfig_rt);

	tryCreateFolder("rtScript")
	tryWriteConfig("rtScript/tsconfig.json", tsconfig_rt);
}
