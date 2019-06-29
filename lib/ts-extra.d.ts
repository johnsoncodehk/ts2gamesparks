import * as ts from "typescript";
export declare function getTsConfig(dir: string): ts.ParsedCommandLine;
export declare function getLanguageService(tsConfig: ts.ParsedCommandLine, dir: string): ts.LanguageService;
