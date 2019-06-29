import * as ts from "typescript";
export interface Options {
    encoding?: string;
    useRequireOnce?: boolean;
}
export declare function createBuilder(dir: string, options?: Options): Builder;
declare class Builder {
    dir: string;
    options: Options;
    tsConfig: ts.ParsedCommandLine;
    services: ts.LanguageService;
    constructor(dir: string, options?: Options);
    buildAllFiles(): void;
    buildFile(fileName: string): void;
    buildJs(fileName: string): string;
}
export declare function init(dir: string): void;
export {};
