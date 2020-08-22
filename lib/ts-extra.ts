import * as ts from "typescript";
import * as path from "upath";

export function getTsConfig(dir: string) {
    const file = ts.findConfigFile(dir, ts.sys.fileExists) as string;
    const config = ts.readJsonConfigFile(file, ts.sys.readFile);
    const content = ts.parseJsonSourceFileConfigFileContent(config, ts.sys, path.dirname(file));
    return content;
}
export function getLanguageService(tsConfig: ts.ParsedCommandLine, dir: string) {
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
            if (ts.sys.fileExists(fileName)) {
                return ts.ScriptSnapshot.fromString(ts.sys.readFile(fileName));
            }
        },
        getCurrentDirectory: () => dir,
        getCompilationSettings: () => tsConfig.options,
        getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
    };

    // Create the language service files
    return ts.createLanguageService(servicesHost, ts.createDocumentRegistry());
}
