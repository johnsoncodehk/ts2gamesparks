export declare function createBuilder(cwd: string): {
    buildAllFiles: () => void;
    buildFile: (fileName: string) => void;
    covertFile: (fileName: string) => string;
};
export declare function init(cwd: string): void;
