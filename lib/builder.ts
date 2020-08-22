import * as ts from "typescript";
import * as fs from "fs-extra";
import * as path from "upath";
import { getTsConfig, getLanguageService } from "./ts-extra";

export function createBuilder(dir: string) {
	dir = path.resolve(dir);

	const tsConfig = getTsConfig(dir);
	const services = getLanguageService(tsConfig, dir);

	return {
		buildAllFiles,
		buildFile,
		buildJs,
	};

	function buildAllFiles() {
		for (const fileName of tsConfig.fileNames) {
			emit(fileName);
		}
	}
	function buildFile(fileName: string) {
		fileName = path.resolve(fileName);

		if (tsConfig.fileNames.includes(fileName)) {
			return emit(fileName);
		}

		throw "file not find in array: " + JSON.stringify(tsConfig.fileNames, undefined, 4);
	}
	function buildJs(fileName: string) {
		fileName = path.resolve(fileName);

		if (tsConfig.fileNames.includes(fileName)) {
			return convert(fileName);
		}

		throw "file not find in array: " + JSON.stringify(tsConfig.fileNames, undefined, 4);
	}
	function emit(fileName: string) {

		const js = convert(fileName);
		const output = services.getEmitOutput(fileName);

		for (const o of output.outputFiles) {
			/**
			 * @example
			 * // before
			 * "dict/modules/folder/moduleA.js"
			 * // after
			 * "dict/modules/folder__moduleA.js"
			 */
			const paths = path.relative(dir, fileName).replace(".ts", ".js").split("/");
			paths.shift(); // remove first folder
			const jsFileName = paths.join("/");
			const newJsFileName = paths.join("__");
			let jsPath = o.name.replace(jsFileName, newJsFileName);

			fs.mkdirpSync(path.dirname(jsPath));
			fs.writeFileSync(jsPath, js);
			console.log(path.relative(dir, fileName) + " => " + path.relative(dir, jsPath))
		}
	}
	function convert(fileName: string) {

		const sourceCode = fs.readFileSync(fileName, "utf8");
		let sourceFile = ts.createSourceFile(fileName, sourceCode, tsConfig.options.target);
		const dirname = path.relative(dir, fileName).split("/").shift();

		if (dirname != "rtScript" && dirname != "rtModules") {
			sourceFile = renameImportModules(fileName, sourceFile);
			convertImportToGamesparksRequire(sourceFile);
		}
		if (dirname == "modules") {
			warpIIFE(sourceFile, dir, fileName);
		}

		let js = ts.transpileModule(ts.createPrinter().printFile(sourceFile), { compilerOptions: tsConfig.options }).outputText;
		js = removeUnderscoreUnderscoreESModule(js, tsConfig);

		return js;
	}
	function renameImportModules(fileName: string, sourceFile: ts.SourceFile) {

		interface RenameInfo {
			renameLocation: ts.RenameLocation,
			newName: string,
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
		function getImportModuleName(importName: string) {
			const filePath = path.join(dir, "modules", importName);
			return path.basename(replaceSeparator(path.relative(dir, filePath)));
		}
		/**
		 * @example
		 * // before
		 * import * as MoudleA as "moduleA";
		 * MoudleA.funcA();
		 * // after
		 * import * as modules__moduleA as "moduleA";
		 * modules__moduleA.funcA();
		 */
		function getNamespaceImportRenameInfos() {
			let renameInfos: RenameInfo[] = [];

			sourceFile.forEachChild(node => {
				if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
					const namespaceImport = node.importClause.namedBindings as ts.NamespaceImport;
					if (namespaceImport.name) {
						const importName = node.moduleSpecifier.text;
						const newImportName = replaceSeparator(importName);

						renameInfos = renameInfos.concat(getRenameInfos(namespaceImport.name.end, getImportModuleName(importName)));
						renameInfos.push(getRenameInfo(node.moduleSpecifier.end, newImportName));
					}
				}
			});

			return renameInfos;
		}
		/**
		 * @example
		 * // before
		 * import { funcA } as "moduleA";
		 * funcA();
		 * // after
		 * import { modules__moduleA.funcA } as "moduleA";
		 * modules__moduleA.funcA();
		 */
		function getNamedImportsRenameInfos() {
			let renameInfos: RenameInfo[] = [];

			sourceFile.forEachChild(node => {
				if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
					const namedImports = node.importClause.namedBindings as ts.NamedImports;
					if (namedImports.elements) {
						const importName = node.moduleSpecifier.text;
						const newImportName = replaceSeparator(importName);
						renameInfos.push(getRenameInfo(node.moduleSpecifier.end, newImportName));

						for (const element of namedImports.elements) {
							const funcName = element.propertyName ? element.propertyName.escapedText : element.name.escapedText;
							renameInfos = renameInfos.concat(getRenameInfos(element.name.end, getImportModuleName(importName) + "." + funcName));
						}
					}
				}
			});

			return renameInfos;
		}

		let renameInfos: RenameInfo[] = [];
		renameInfos = renameInfos.concat(getNamespaceImportRenameInfos());
		renameInfos = renameInfos.concat(getNamedImportsRenameInfos());

		/**
		 * Apply
		 */
		renameInfos = renameInfos.sort((a, b) => { return b.renameLocation.textSpan.start - a.renameLocation.textSpan.start; });
		let newText = sourceFile.text;
		for (const info of renameInfos) {
			newText = newText.substr(0, info.renameLocation.textSpan.start) + info.newName + newText.substr(info.renameLocation.textSpan.start + info.renameLocation.textSpan.length);
		}
		return ts.createSourceFile(sourceFile.fileName, newText, sourceFile.languageVersion);
	}
}

/**
 * @example
 * // before
 * var Module = require("module")
 * // after
 * require("module"); // !useRequireOnce
 * requireOnce("module"); // useRequireOnce
 */
function convertImportToGamesparksRequire(sourceFile: ts.SourceFile) {
	sourceFile.forEachChild(function (node) {
		if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
			// @ts-ignore
			node.kind = ts.SyntaxKind.ExpressionStatement;
			// @ts-ignore
			node.expression = ts.createCall(
				ts.createIdentifier("requireOnce"),
				undefined,
				[node.moduleSpecifier],
			);
		}
	});
}

/**
 * @example
 * // before
 * const foo = "foo";
 * // after
 * const modules__name = (function () {
 *     const foo = "foo";
 *     return {
 *         foo: foo,
 *     };
 * })();
 */
function warpIIFE(sourceFile: ts.SourceFile, dir: string, fileName: string) {

	function addExportProperty(name: ts.Identifier) {
		if (name) {
			const internalName = name.escapedText as string;
			const exportName = internalName;
			const property = ts.createPropertyAssignment(exportName, ts.createIdentifier(internalName))
			properties.push(property);
		}
	}
	function isDeclaration(node: ts.Node): node is ts.DeclarationStatement {
		return ts.isFunctionDeclaration(node) || ts.isEnumDeclaration(node) || ts.isClassDeclaration(node) || ts.isModuleDeclaration(node);
	}

	const properties: ts.ObjectLiteralElementLike[] = [];

	for (let i = 0; i < sourceFile.statements.length; i++) {
		const node = sourceFile.statements[i];
		if (node.modifiers && node.modifiers.find(m => m.kind == ts.SyntaxKind.ExportKeyword)) {
			// @ts-ignore
			node.modifiers = ts.createNodeArray(node.modifiers.filter(m => m.kind != ts.SyntaxKind.ExportKeyword));
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

	const funcReturn = ts.createReturn(ts.createObjectLiteral(properties, true));
	const funcBody = ts.createArrowFunction([], [], [], undefined, undefined, ts.createBlock([...sourceFile.statements, funcReturn]));
	const moduleName = path.basename(replaceSeparator(path.relative(dir, fileName)), ".ts"); // "modules__foo" | "modules__folder__bar"
	const callFuncDecl = ts.createVariableDeclaration(moduleName, undefined, ts.createCall(funcBody, [], []))
	const callFuncStat = ts.createVariableStatement([], [callFuncDecl]);

	// @ts-ignore
	sourceFile.statements = ts.createNodeArray([callFuncStat]);
}

/**
 * @example
 * // before
 * Object.defineProperty(exports, "__esModule", { value: true });
 * // after
 * 👐
 */
function removeUnderscoreUnderscoreESModule(js: string, tsConfig: ts.ParsedCommandLine) {
	const newLine = ts["getNewLineCharacter"](tsConfig.options);
	return js.replace('Object.defineProperty(exports, "__esModule", { value: true });' + newLine, "")
}

/**
 * @example
 * replaceSeparator("folder/moduleA") // "folder__moduleA"
 */
function replaceSeparator(name: string) {
	return name.replace(new RegExp("/", "g"), "__");
}

