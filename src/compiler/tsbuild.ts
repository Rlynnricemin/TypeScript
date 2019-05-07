/*@internal*/
namespace ts {
    export enum UpToDateStatusType {
        Unbuildable,
        UpToDate,
        /**
         * The project appears out of date because its upstream inputs are newer than its outputs,
         * but all of its outputs are actually newer than the previous identical outputs of its (.d.ts) inputs.
         * This means we can Pseudo-build (just touch timestamps), as if we had actually built this project.
         */
        UpToDateWithUpstreamTypes,
        /**
         * The project appears out of date because its upstream inputs are newer than its outputs,
         * but all of its outputs are actually newer than the previous identical outputs of its (.d.ts) inputs.
         * This means we can Pseudo-build (just manipulate outputs), as if we had actually built this project.
         */
        OutOfDateWithPrepend,
        OutputMissing,
        OutOfDateWithSelf,
        OutOfDateWithUpstream,
        UpstreamOutOfDate,
        UpstreamBlocked,
        ComputingUpstream,
        TsVersionOutputOfDate,

        /**
         * Projects with no outputs (i.e. "solution" files)
         */
        ContainerOnly
    }

    export type UpToDateStatus =
        | Status.Unbuildable
        | Status.UpToDate
        | Status.OutOfDateWithPrepend
        | Status.OutputMissing
        | Status.OutOfDateWithSelf
        | Status.OutOfDateWithUpstream
        | Status.UpstreamOutOfDate
        | Status.UpstreamBlocked
        | Status.ComputingUpstream
        | Status.TsVersionOutOfDate
        | Status.ContainerOnly;

    export namespace Status {
        /**
         * The project can't be built at all in its current state. For example,
         * its config file cannot be parsed, or it has a syntax error or missing file
         */
        export interface Unbuildable {
            type: UpToDateStatusType.Unbuildable;
            reason: string;
        }

        /**
         * This project doesn't have any outputs, so "is it up to date" is a meaningless question.
         */
        export interface ContainerOnly {
            type: UpToDateStatusType.ContainerOnly;
        }

        /**
         * The project is up to date with respect to its inputs.
         * We track what the newest input file is.
         */
        export interface UpToDate {
            type: UpToDateStatusType.UpToDate | UpToDateStatusType.UpToDateWithUpstreamTypes;
            newestInputFileTime?: Date;
            newestInputFileName?: string;
            newestDeclarationFileContentChangedTime?: Date;
            newestOutputFileTime?: Date;
            newestOutputFileName?: string;
            oldestOutputFileName: string;
        }

        /**
         * The project is up to date with respect to its inputs except for prepend output changed (no declaration file change in prepend).
         */
        export interface OutOfDateWithPrepend {
            type: UpToDateStatusType.OutOfDateWithPrepend;
            outOfDateOutputFileName: string;
            newerProjectName: string;
        }

        /**
         * One or more of the outputs of the project does not exist.
         */
        export interface OutputMissing {
            type: UpToDateStatusType.OutputMissing;
            /**
             * The name of the first output file that didn't exist
             */
            missingOutputFileName: string;
        }

        /**
         * One or more of the project's outputs is older than its newest input.
         */
        export interface OutOfDateWithSelf {
            type: UpToDateStatusType.OutOfDateWithSelf;
            outOfDateOutputFileName: string;
            newerInputFileName: string;
        }

        /**
         * This project depends on an out-of-date project, so shouldn't be built yet
         */
        export interface UpstreamOutOfDate {
            type: UpToDateStatusType.UpstreamOutOfDate;
            upstreamProjectName: string;
        }

        /**
         * This project depends an upstream project with build errors
         */
        export interface UpstreamBlocked {
            type: UpToDateStatusType.UpstreamBlocked;
            upstreamProjectName: string;
        }

        /**
         *  Computing status of upstream projects referenced
         */
        export interface ComputingUpstream {
            type: UpToDateStatusType.ComputingUpstream;
        }

        export interface TsVersionOutOfDate {
            type: UpToDateStatusType.TsVersionOutputOfDate;
            version: string;
        }

        /**
         * One or more of the project's outputs is older than the newest output of
         * an upstream project.
         */
        export interface OutOfDateWithUpstream {
            type: UpToDateStatusType.OutOfDateWithUpstream;
            outOfDateOutputFileName: string;
            newerProjectName: string;
        }
    }

    export function resolveConfigFileProjectName(project: string): ResolvedConfigFileName {
        if (fileExtensionIs(project, Extension.Json)) {
            return project as ResolvedConfigFileName;
        }

        return combinePaths(project, "tsconfig.json") as ResolvedConfigFileName;
    }
}

namespace ts {
    const minimumDate = new Date(-8640000000000000);
    const maximumDate = new Date(8640000000000000);

    export interface BuildOptions {
        dry?: boolean;
        force?: boolean;
        verbose?: boolean;

        /*@internal*/ clean?: boolean;
        /*@internal*/ watch?: boolean;
        /*@internal*/ help?: boolean;

        preserveWatchOutput?: boolean;
        listEmittedFiles?: boolean;
        listFiles?: boolean;
        pretty?: boolean;
        incremental?: boolean;

        traceResolution?: boolean;
        /* @internal */ diagnostics?: boolean;
        /* @internal */ extendedDiagnostics?: boolean;

        [option: string]: CompilerOptionsValue | undefined;
    }

    enum BuildResultFlags {
        None = 0,

        /**
         * No errors of any kind occurred during build
         */
        Success = 1 << 0,
        /**
         * None of the .d.ts files emitted by this build were
         * different from the existing files on disk
         */
        DeclarationOutputUnchanged = 1 << 1,

        ConfigFileErrors = 1 << 2,
        SyntaxErrors = 1 << 3,
        TypeErrors = 1 << 4,
        DeclarationEmitErrors = 1 << 5,
        EmitErrors = 1 << 6,

        AnyErrors = ConfigFileErrors | SyntaxErrors | TypeErrors | DeclarationEmitErrors | EmitErrors
    }

    /*@internal*/
    export type ResolvedConfigFilePath = ResolvedConfigFileName & Path;
    interface FileMap<T, U extends Path = Path> extends Map<T> {
        get(key: U): T | undefined;
        has(key: U): boolean;
        forEach(action: (value: T, key: U) => void): void;
        readonly size: number;
        keys(): Iterator<U>;
        values(): Iterator<T>;
        entries(): Iterator<[U, T]>;
        set(key: U, value: T): this;
        delete(key: U): boolean;
        clear(): void;
    }
    type ConfigFileMap<T> = FileMap<T, ResolvedConfigFilePath>;
    function createConfigFileMap<T>(): ConfigFileMap<T> {
        return createMap() as ConfigFileMap<T>;
    }

    function getOrCreateValueFromConfigFileMap<T>(configFileMap: ConfigFileMap<T>, resolved: ResolvedConfigFilePath, createT: () => T): T {
        const existingValue = configFileMap.get(resolved);
        let newValue: T | undefined;
        if (!existingValue) {
            newValue = createT();
            configFileMap.set(resolved, newValue);
        }
        return existingValue || newValue!;
    }

    function getOrCreateValueMapFromConfigFileMap<T>(configFileMap: ConfigFileMap<Map<T>>, resolved: ResolvedConfigFilePath): Map<T> {
        return getOrCreateValueFromConfigFileMap<Map<T>>(configFileMap, resolved, createMap);
    }

    function newer(date1: Date, date2: Date): Date {
        return date2 > date1 ? date2 : date1;
    }

    function isDeclarationFile(fileName: string) {
        return fileExtensionIs(fileName, Extension.Dts);
    }

    export type ReportEmitErrorSummary = (errorCount: number) => void;

    export interface SolutionBuilderHostBase<T extends BuilderProgram> extends ProgramHost<T> {
        getModifiedTime(fileName: string): Date | undefined;
        setModifiedTime(fileName: string, date: Date): void;
        deleteFile(fileName: string): void;

        reportDiagnostic: DiagnosticReporter; // Technically we want to move it out and allow steps of actions on Solution, but for now just merge stuff in build host here
        reportSolutionBuilderStatus: DiagnosticReporter;

        // TODO: To do better with watch mode and normal build mode api that creates program and emits files
        // This currently helps enable --diagnostics and --extendedDiagnostics
        afterProgramEmitAndDiagnostics?(program: T): void;

        // For testing
        /*@internal*/ now?(): Date;
    }

    export interface SolutionBuilderHost<T extends BuilderProgram> extends SolutionBuilderHostBase<T> {
        reportErrorSummary?: ReportEmitErrorSummary;
    }

    export interface SolutionBuilderWithWatchHost<T extends BuilderProgram> extends SolutionBuilderHostBase<T>, WatchHost {
    }

    export interface SolutionBuilderResult<T> {
        project: ResolvedConfigFileName;
        result: T;
    }

    export interface SolutionBuilder {
        build(project?: string, cancellationToken?: CancellationToken): ExitStatus;
        clean(project?: string): ExitStatus;
        buildNextProject(cancellationToken?: CancellationToken): SolutionBuilderResult<ExitStatus> | undefined;

        // Currently used for testing but can be made public if needed:
        /*@internal*/ getBuildOrder(): ReadonlyArray<ResolvedConfigFileName>;

        // Testing only
        /*@internal*/ getUpToDateStatusOfProject(project: string): UpToDateStatus;
        /*@internal*/ invalidateProject(configFilePath: ResolvedConfigFilePath, reloadLevel?: ConfigFileProgramReloadLevel): void;
        /*@internal*/ buildNextInvalidatedProject(): void;
    }

    /**
     * Create a function that reports watch status by writing to the system and handles the formating of the diagnostic
     */
    export function createBuilderStatusReporter(system: System, pretty?: boolean): DiagnosticReporter {
        return diagnostic => {
            let output = pretty ? `[${formatColorAndReset(new Date().toLocaleTimeString(), ForegroundColorEscapeSequences.Grey)}] ` : `${new Date().toLocaleTimeString()} - `;
            output += `${flattenDiagnosticMessageText(diagnostic.messageText, system.newLine)}${system.newLine + system.newLine}`;
            system.write(output);
        };
    }

    function createSolutionBuilderHostBase<T extends BuilderProgram>(system: System, createProgram: CreateProgram<T> | undefined, reportDiagnostic?: DiagnosticReporter, reportSolutionBuilderStatus?: DiagnosticReporter) {
        const host = createProgramHost(system, createProgram) as SolutionBuilderHostBase<T>;
        host.getModifiedTime = system.getModifiedTime ? path => system.getModifiedTime!(path) : returnUndefined;
        host.setModifiedTime = system.setModifiedTime ? (path, date) => system.setModifiedTime!(path, date) : noop;
        host.deleteFile = system.deleteFile ? path => system.deleteFile!(path) : noop;
        host.reportDiagnostic = reportDiagnostic || createDiagnosticReporter(system);
        host.reportSolutionBuilderStatus = reportSolutionBuilderStatus || createBuilderStatusReporter(system);
        return host;
    }

    export function createSolutionBuilderHost<T extends BuilderProgram = EmitAndSemanticDiagnosticsBuilderProgram>(system = sys, createProgram?: CreateProgram<T>, reportDiagnostic?: DiagnosticReporter, reportSolutionBuilderStatus?: DiagnosticReporter, reportErrorSummary?: ReportEmitErrorSummary) {
        const host = createSolutionBuilderHostBase(system, createProgram, reportDiagnostic, reportSolutionBuilderStatus) as SolutionBuilderHost<T>;
        host.reportErrorSummary = reportErrorSummary;
        return host;
    }

    export function createSolutionBuilderWithWatchHost<T extends BuilderProgram = EmitAndSemanticDiagnosticsBuilderProgram>(system = sys, createProgram?: CreateProgram<T>, reportDiagnostic?: DiagnosticReporter, reportSolutionBuilderStatus?: DiagnosticReporter, reportWatchStatus?: WatchStatusReporter) {
        const host = createSolutionBuilderHostBase(system, createProgram, reportDiagnostic, reportSolutionBuilderStatus) as SolutionBuilderWithWatchHost<T>;
        const watchHost = createWatchHost(system, reportWatchStatus);
        copyProperties(host, watchHost);
        return host;
    }

    function getCompilerOptionsOfBuildOptions(buildOptions: BuildOptions): CompilerOptions {
        const result = {} as CompilerOptions;
        commonOptionsWithBuild.forEach(option => {
            if (hasProperty(buildOptions, option.name)) result[option.name] = buildOptions[option.name];
        });
        return result;
    }

    export function createSolutionBuilder<T extends BuilderProgram>(host: SolutionBuilderHost<T>, rootNames: ReadonlyArray<string>, defaultOptions: BuildOptions): SolutionBuilder {
        return createSolutionBuilderWorker(/*watch*/ false, host, rootNames, defaultOptions);
    }

    export function createSolutionBuilderWithWatch<T extends BuilderProgram>(host: SolutionBuilderWithWatchHost<T>, rootNames: ReadonlyArray<string>, defaultOptions: BuildOptions): SolutionBuilder {
        return createSolutionBuilderWorker(/*watch*/ true, host, rootNames, defaultOptions);
    }

    type ConfigFileCacheEntry = ParsedCommandLine | Diagnostic;
    interface SolutionBuilderStateCache {
        originalReadFile: CompilerHost["readFile"];
        originalFileExists: CompilerHost["fileExists"];
        originalDirectoryExists: CompilerHost["directoryExists"];
        originalCreateDirectory: CompilerHost["createDirectory"];
        originalWriteFile: CompilerHost["writeFile"] | undefined;
        originalReadFileWithCache: CompilerHost["readFile"];
        originalGetSourceFile: CompilerHost["getSourceFile"];
    }

    interface SolutionBuilderState<T extends BuilderProgram = BuilderProgram> {
        readonly host: SolutionBuilderHost<T>;
        readonly hostWithWatch: SolutionBuilderWithWatchHost<T>;
        readonly currentDirectory: string;
        readonly getCanonicalFileName: GetCanonicalFileName;
        readonly parseConfigFileHost: ParseConfigFileHost;
        readonly writeFileName: ((s: string) => void) | undefined;

        // State of solution
        readonly options: BuildOptions;
        readonly baseCompilerOptions: CompilerOptions;
        readonly rootNames: ReadonlyArray<string>;

        readonly resolvedConfigFilePaths: Map<ResolvedConfigFilePath>;
        readonly configFileCache: ConfigFileMap<ConfigFileCacheEntry>;
        /** Map from config file name to up-to-date status */
        readonly projectStatus: ConfigFileMap<UpToDateStatus>;
        readonly buildInfoChecked: ConfigFileMap<true>;
        readonly extendedConfigCache: Map<ExtendedConfigCacheEntry>;

        readonly builderPrograms: ConfigFileMap<T>;
        readonly diagnostics: ConfigFileMap<readonly Diagnostic[]>;
        readonly projectPendingBuild: ConfigFileMap<ConfigFileProgramReloadLevel>;
        readonly projectErrorsReported: ConfigFileMap<true>;

        readonly compilerHost: CompilerHost;
        readonly moduleResolutionCache: ModuleResolutionCache | undefined;

        // Mutable state
        buildOrder: readonly ResolvedConfigFileName[] | undefined;
        readFileWithCache: (f: string) => string | undefined;
        projectCompilerOptions: CompilerOptions;
        cache: SolutionBuilderStateCache | undefined;
        allProjectBuildPending: boolean;
        needsSummary: boolean;
        watchAllProjectsPending: boolean;

        // Watch state
        readonly watch: boolean;
        readonly allWatchedWildcardDirectories: ConfigFileMap<Map<WildcardDirectoryWatcher>>;
        readonly allWatchedInputFiles: ConfigFileMap<Map<FileWatcher>>;
        readonly allWatchedConfigFiles: ConfigFileMap<FileWatcher>;

        timerToBuildInvalidatedProject: any;
        reportFileChangeDetected: boolean;
        watchFile: WatchFile<WatchType, ResolvedConfigFileName>;
        watchFilePath: WatchFilePath<WatchType, ResolvedConfigFileName>;
        watchDirectory: WatchDirectory<WatchType, ResolvedConfigFileName>;
        writeLog: (s: string) => void;
    }

    function createSolutionBuilderState<T extends BuilderProgram>(watch: boolean, hostOrHostWithWatch: SolutionBuilderHost<T> | SolutionBuilderWithWatchHost<T>, rootNames: ReadonlyArray<string>, options: BuildOptions): SolutionBuilderState<T> {
        const host = hostOrHostWithWatch as SolutionBuilderHost<T>;
        const hostWithWatch = hostOrHostWithWatch as SolutionBuilderWithWatchHost<T>;
        const currentDirectory = host.getCurrentDirectory();
        const getCanonicalFileName = createGetCanonicalFileName(host.useCaseSensitiveFileNames());

        // State of the solution
        const baseCompilerOptions = getCompilerOptionsOfBuildOptions(options);
        const compilerHost = createCompilerHostFromProgramHost(host, () => state.projectCompilerOptions);
        setGetSourceFileAsHashVersioned(compilerHost, host);
        compilerHost.getParsedCommandLine = fileName => parseConfigFile(state, fileName as ResolvedConfigFileName, toResolvedConfigFilePath(state, fileName as ResolvedConfigFileName));
        compilerHost.resolveModuleNames = maybeBind(host, host.resolveModuleNames);
        compilerHost.resolveTypeReferenceDirectives = maybeBind(host, host.resolveTypeReferenceDirectives);
        const moduleResolutionCache = !compilerHost.resolveModuleNames ? createModuleResolutionCache(currentDirectory, getCanonicalFileName) : undefined;
        if (!compilerHost.resolveModuleNames) {
            const loader = (moduleName: string, containingFile: string, redirectedReference: ResolvedProjectReference | undefined) => resolveModuleName(moduleName, containingFile, state.projectCompilerOptions, compilerHost, moduleResolutionCache, redirectedReference).resolvedModule!;
            compilerHost.resolveModuleNames = (moduleNames, containingFile, _reusedNames, redirectedReference) =>
                loadWithLocalCache<ResolvedModuleFull>(Debug.assertEachDefined(moduleNames), containingFile, redirectedReference, loader);
        }

        const { watchFile, watchFilePath, watchDirectory, writeLog } = createWatchFactory<ResolvedConfigFileName>(hostWithWatch, options);

        const state: SolutionBuilderState<T> = {
            host,
            hostWithWatch,
            currentDirectory,
            getCanonicalFileName,
            parseConfigFileHost: parseConfigHostFromCompilerHostLike(host),
            writeFileName: host.trace ? (s: string) => host.trace!(s) : undefined,

            // State of solution
            options,
            baseCompilerOptions,
            rootNames,

            resolvedConfigFilePaths: createMap(),
            configFileCache: createConfigFileMap(),
            projectStatus: createConfigFileMap(),
            buildInfoChecked: createConfigFileMap(),
            extendedConfigCache: createMap(),

            builderPrograms: createConfigFileMap(),
            diagnostics: createConfigFileMap(),
            projectPendingBuild: createConfigFileMap(),
            projectErrorsReported: createConfigFileMap(),

            compilerHost,
            moduleResolutionCache,

            // Mutable state
            buildOrder: undefined,
            readFileWithCache: f => host.readFile(f),
            projectCompilerOptions: baseCompilerOptions,
            cache: undefined,
            allProjectBuildPending: true,
            needsSummary: true,
            watchAllProjectsPending: watch,

            // Watch state
            watch,
            allWatchedWildcardDirectories: createConfigFileMap(),
            allWatchedInputFiles: createConfigFileMap(),
            allWatchedConfigFiles: createConfigFileMap(),

            timerToBuildInvalidatedProject: undefined,
            reportFileChangeDetected: false,
            watchFile,
            watchFilePath,
            watchDirectory,
            writeLog,
        };

        return state;
    }

    function toPath(state: SolutionBuilderState, fileName: string) {
        return ts.toPath(fileName, state.currentDirectory, state.getCanonicalFileName);
    }

    function toResolvedConfigFilePath(state: SolutionBuilderState, fileName: ResolvedConfigFileName): ResolvedConfigFilePath {
        const { resolvedConfigFilePaths } = state;
        const path = resolvedConfigFilePaths.get(fileName);
        if (path !== undefined) return path;

        const resolvedPath = toPath(state, fileName) as ResolvedConfigFilePath;
        resolvedConfigFilePaths.set(fileName, resolvedPath);
        return resolvedPath;
    }

    function isParsedCommandLine(entry: ConfigFileCacheEntry): entry is ParsedCommandLine {
        return !!(entry as ParsedCommandLine).options;
    }

    function parseConfigFile(state: SolutionBuilderState, configFileName: ResolvedConfigFileName, configFilePath: ResolvedConfigFilePath): ParsedCommandLine | undefined {
        const { configFileCache } = state;
        const value = configFileCache.get(configFilePath);
        if (value) {
            return isParsedCommandLine(value) ? value : undefined;
        }

        let diagnostic: Diagnostic | undefined;
        const { parseConfigFileHost, baseCompilerOptions, extendedConfigCache } = state;
        parseConfigFileHost.onUnRecoverableConfigFileDiagnostic = d => diagnostic = d;
        const parsed = getParsedCommandLineOfConfigFile(configFileName, baseCompilerOptions, parseConfigFileHost, extendedConfigCache);
        parseConfigFileHost.onUnRecoverableConfigFileDiagnostic = noop;
        configFileCache.set(configFilePath, parsed || diagnostic!);
        return parsed;
    }

    function resolveProjectName(state: SolutionBuilderState, name: string): ResolvedConfigFileName {
        return resolveConfigFileProjectName(resolvePath(state.currentDirectory, name));
    }

    function createBuildOrder(state: SolutionBuilderState, roots: readonly ResolvedConfigFileName[]): readonly ResolvedConfigFileName[] {
        const temporaryMarks = createMap() as ConfigFileMap<true>;
        const permanentMarks = createMap() as ConfigFileMap<true>;
        const circularityReportStack: string[] = [];
        let buildOrder: ResolvedConfigFileName[] | undefined;
        for (const root of roots) {
            visit(root);
        }

        return buildOrder || emptyArray;

        function visit(configFileName: ResolvedConfigFileName, inCircularContext?: boolean) {
            const projPath = toResolvedConfigFilePath(state, configFileName);
            // Already visited
            if (permanentMarks.has(projPath)) return;
            // Circular
            if (temporaryMarks.has(projPath)) {
                if (!inCircularContext) {
                    // TODO:: Do we report this as error?
                    reportStatus(state, Diagnostics.Project_references_may_not_form_a_circular_graph_Cycle_detected_Colon_0, circularityReportStack.join("\r\n"));
                }
                return;
            }

            temporaryMarks.set(projPath, true);
            circularityReportStack.push(configFileName);
            const parsed = parseConfigFile(state, configFileName, projPath);
            if (parsed && parsed.projectReferences) {
                for (const ref of parsed.projectReferences) {
                    const resolvedRefPath = resolveProjectName(state, ref.path);
                    visit(resolvedRefPath, inCircularContext || ref.circular);
                }
            }

            circularityReportStack.pop();
            permanentMarks.set(projPath, true);
            (buildOrder || (buildOrder = [])).push(configFileName);
        }
    }

    function getBuildOrder(state: SolutionBuilderState) {
        return state.buildOrder ||
            (state.buildOrder = createBuildOrder(state, state.rootNames.map(f => resolveProjectName(state, f))));
    }

    function getBuildOrderFor(state: SolutionBuilderState, project: string | undefined) {
        const resolvedProject = project && resolveProjectName(state, project);
        if (resolvedProject) {
            const projectPath = toResolvedConfigFilePath(state, resolvedProject);
            const projectIndex = findIndex(
                getBuildOrder(state),
                configFileName => toResolvedConfigFilePath(state, configFileName) === projectPath
            );
            if (projectIndex === -1) return undefined;
        }
        return resolvedProject ? createBuildOrder(state, [resolvedProject]) : getBuildOrder(state);
    }

    function enableCache(state: SolutionBuilderState) {
        if (state.cache) {
            disableCache(state);
        }

        const { compilerHost, host } = state;

        const originalReadFileWithCache = state.readFileWithCache;
        const originalGetSourceFile = compilerHost.getSourceFile;

        const {
            originalReadFile, originalFileExists, originalDirectoryExists,
            originalCreateDirectory, originalWriteFile,
            getSourceFileWithCache, readFileWithCache
        } = changeCompilerHostLikeToUseCache(
            host,
            fileName => toPath(state, fileName),
            (...args) => originalGetSourceFile.call(compilerHost, ...args)
        );
        state.readFileWithCache = readFileWithCache;
        compilerHost.getSourceFile = getSourceFileWithCache!;

        state.cache = {
            originalReadFile,
            originalFileExists,
            originalDirectoryExists,
            originalCreateDirectory,
            originalWriteFile,
            originalReadFileWithCache,
            originalGetSourceFile,
        };
    }

    function disableCache(state: SolutionBuilderState) {
        if (!state.cache) return;

        const { cache, host, compilerHost, extendedConfigCache, moduleResolutionCache } = state;

        host.readFile = cache.originalReadFile;
        host.fileExists = cache.originalFileExists;
        host.directoryExists = cache.originalDirectoryExists;
        host.createDirectory = cache.originalCreateDirectory;
        host.writeFile = cache.originalWriteFile;
        compilerHost.getSourceFile = cache.originalGetSourceFile;
        state.readFileWithCache = cache.originalReadFileWithCache;
        extendedConfigCache.clear();
        if (moduleResolutionCache) {
            moduleResolutionCache.directoryToModuleNameMap.clear();
            moduleResolutionCache.moduleNameToDirectoryMap.clear();
        }
        state.cache = undefined;
    }

    function clearProjectStatus(state: SolutionBuilderState, resolved: ResolvedConfigFilePath) {
        state.projectStatus.delete(resolved);
        state.diagnostics.delete(resolved);
    }

    function addProjToQueue({ projectPendingBuild }: SolutionBuilderState, proj: ResolvedConfigFilePath, reloadLevel: ConfigFileProgramReloadLevel) {
        const value = projectPendingBuild.get(proj);
        if (value === undefined) {
            projectPendingBuild.set(proj, reloadLevel);
        }
        else if (value < reloadLevel) {
            projectPendingBuild.set(proj, reloadLevel);
        }
    }

    function setupInitialBuild(state: SolutionBuilderState, cancellationToken: CancellationToken | undefined) {
        // Set initial build if not already built
        if (!state.allProjectBuildPending) return;
        state.allProjectBuildPending = false;
        if (state.options.watch) { reportWatchStatus(state, Diagnostics.Starting_compilation_in_watch_mode); }
        enableCache(state);
        const buildOrder = getBuildOrder(state);
        reportBuildQueue(state, buildOrder);
        buildOrder.forEach(configFileName =>
            state.projectPendingBuild.set(
                toResolvedConfigFilePath(state, configFileName),
                ConfigFileProgramReloadLevel.None
            )
        );

        if (cancellationToken) {
            cancellationToken.throwIfCancellationRequested();
        }
    }

    const enum InvalidatedProjectKind {
        Build,
        UpdateBundle,
        UpdateOutputFileStamps
    }

    interface InvalidatedProjectBase {
        readonly kind: InvalidatedProjectKind;
        readonly project: ResolvedConfigFileName;
        readonly projectPath: ResolvedConfigFilePath;
        /**
         *  To dispose this project and ensure that all the necessary actions are taken and state is updated accordingly
         */
        done(cancellationToken?: CancellationToken): void;
    }

    interface UpdateOutputFileStampsProject extends InvalidatedProjectBase {
        readonly kind: InvalidatedProjectKind.UpdateOutputFileStamps;
        updateOutputFileStatmps(): void;
    }

    interface BuildInvalidedProject extends InvalidatedProjectBase {
        readonly kind: InvalidatedProjectKind.Build;
        build(cancellationToken?: CancellationToken): BuildResultFlags;
    }

    interface UpdateBundleProject extends InvalidatedProjectBase {
        readonly kind: InvalidatedProjectKind.UpdateBundle;
        updateBundle(): BuildResultFlags | BuildInvalidedProject;
    }

    type InvalidatedProject = UpdateOutputFileStampsProject | BuildInvalidedProject | UpdateBundleProject;

    function createUpdateOutputFileStampsProject(state: SolutionBuilderState, project: ResolvedConfigFileName, projectPath: ResolvedConfigFilePath, config: ParsedCommandLine): UpdateOutputFileStampsProject {
        let updateOutputFileStampsPending = true;
        return {
            kind: InvalidatedProjectKind.UpdateOutputFileStamps,
            project,
            projectPath,
            updateOutputFileStatmps: () => {
                updateOutputTimestamps(state, config, projectPath);
                updateOutputFileStampsPending = false;
            },
            done: () => {
                if (updateOutputFileStampsPending) {
                    updateOutputTimestamps(state, config, projectPath);
                }
                state.projectPendingBuild.delete(projectPath);
            }
        };
    }

    function createBuildInvalidedProject(
        state: SolutionBuilderState,
        project: ResolvedConfigFileName,
        projectPath: ResolvedConfigFilePath,
        projectIndex: number,
        config: ParsedCommandLine,
        buildOrder: readonly ResolvedConfigFileName[]
    ): BuildInvalidedProject {
        let buildPending = true;
        return {
            kind: InvalidatedProjectKind.Build,
            project,
            projectPath,
            build,
            done: cancellationToken => {
                if (buildPending) build(cancellationToken);
                state.projectPendingBuild.delete(projectPath);
            }
        };

        function build(cancellationToken?: CancellationToken) {
            const buildResult = buildSingleProject(state, project, projectPath, config, cancellationToken);
            queueReferencingProjects(state, project, projectPath, projectIndex, config, buildOrder, buildResult);
            buildPending = false;
            return buildResult;
        }
    }

    function createUpdateBundleProject(
        state: SolutionBuilderState,
        project: ResolvedConfigFileName,
        projectPath: ResolvedConfigFilePath,
        projectIndex: number,
        config: ParsedCommandLine,
        buildOrder: readonly ResolvedConfigFileName[]
    ): UpdateBundleProject {
        let updatePending = true;
        return {
            kind: InvalidatedProjectKind.UpdateBundle,
            project,
            projectPath,
            updateBundle: update,
            done: cancellationToken => {
                if (updatePending) {
                    const result = update();
                    if ((result as BuildInvalidedProject).project) {
                        return (result as BuildInvalidedProject).done(cancellationToken);
                    }
                }
                state.projectPendingBuild.delete(projectPath);
            }
        };

        function update() {
            const buildResult = updateBundle(state, project, projectPath, config);
            if (isString(buildResult)) {
                return createBuildInvalidedProject(state, project, projectPath, projectIndex, config, buildOrder);
            }
            queueReferencingProjects(state, project, projectPath, projectIndex, config, buildOrder, buildResult);
            updatePending = false;
            return buildResult;
        }
    }

    function needsBuild({ options }: SolutionBuilderState, status: UpToDateStatus, config: ParsedCommandLine) {
        if (status.type !== UpToDateStatusType.OutOfDateWithPrepend || options.force) return true;
        return config.fileNames.length === 0 ||
            !!config.errors.length ||
            !isIncrementalCompilation(config.options);
    }

    function getNextInvalidatedProject(state: SolutionBuilderState, buildOrder: readonly ResolvedConfigFileName[]): InvalidatedProject | undefined {
        if (!state.projectPendingBuild.size) return undefined;

        const { options, projectPendingBuild } = state;
        for (let projectIndex = 0; projectIndex < buildOrder.length; projectIndex++) {
            const project = buildOrder[projectIndex];
            const projectPath = toResolvedConfigFilePath(state, project);
            const reloadLevel = state.projectPendingBuild.get(projectPath);
            if (reloadLevel === undefined) continue;

            const config = parseConfigFile(state, project, projectPath);
            if (!config) {
                reportParseConfigFileDiagnostic(state, projectPath);
                projectPendingBuild.delete(projectPath);
                continue;
            }

            if (reloadLevel === ConfigFileProgramReloadLevel.Full) {
                watchConfigFile(state, project, projectPath);
                watchWildCardDirectories(state, project, projectPath, config);
                watchInputFiles(state, project, projectPath, config);
            }
            else if (reloadLevel === ConfigFileProgramReloadLevel.Partial) {
                // Update file names
                const result = getFileNamesFromConfigSpecs(config.configFileSpecs!, getDirectoryPath(project), config.options, state.parseConfigFileHost);
                updateErrorForNoInputFiles(result, project, config.configFileSpecs!, config.errors, canJsonReportNoInutFiles(config.raw));
                config.fileNames = result.fileNames;
                watchInputFiles(state, project, projectPath, config);
            }

            const status = getUpToDateStatus(state, config, projectPath);
            verboseReportProjectStatus(state, project, status);
            if (!options.force) {
                if (status.type === UpToDateStatusType.UpToDate) {
                    reportAndStoreErrors(state, projectPath, config.errors);
                    projectPendingBuild.delete(projectPath);
                    // Up to date, skip
                    if (options.dry) {
                        // In a dry build, inform the user of this fact
                        reportStatus(state, Diagnostics.Project_0_is_up_to_date, project);
                    }
                    continue;
                }

                if (status.type === UpToDateStatusType.UpToDateWithUpstreamTypes) {
                    reportAndStoreErrors(state, projectPath, config.errors);
                    return createUpdateOutputFileStampsProject(
                        state,
                        project,
                        projectPath,
                        config
                    );
                }
            }

            if (status.type === UpToDateStatusType.UpstreamBlocked) {
                reportAndStoreErrors(state, projectPath, config.errors);
                projectPendingBuild.delete(projectPath);
                if (options.verbose) reportStatus(state, Diagnostics.Skipping_build_of_project_0_because_its_dependency_1_has_errors, project, status.upstreamProjectName);
                continue;
            }

            if (status.type === UpToDateStatusType.ContainerOnly) {
                reportAndStoreErrors(state, projectPath, config.errors);
                projectPendingBuild.delete(projectPath);
                // Do nothing
                continue;
            }

            return needsBuild(state, status, config) ?
                createBuildInvalidedProject(state, project, projectPath, projectIndex, config, buildOrder) :
                createUpdateBundleProject(state, project, projectPath, projectIndex, config, buildOrder);
        }

        return undefined;
    }

    function listEmittedFile({ writeFileName }: SolutionBuilderState, proj: ParsedCommandLine, file: string) {
        if (writeFileName && proj.options.listEmittedFiles) {
            writeFileName(`TSFILE: ${file}`);
        }
    }

    function getOldProgram<T extends BuilderProgram>({ options, builderPrograms, readFileWithCache }: SolutionBuilderState<T>, proj: ResolvedConfigFilePath, parsed: ParsedCommandLine) {
        if (options.force) return undefined;
        const value = builderPrograms.get(proj);
        if (value) return value;
        return readBuilderProgram(parsed.options, readFileWithCache) as any as T;
    }

    function afterProgramCreate<T extends BuilderProgram>({ host, watch, builderPrograms }: SolutionBuilderState<T>, proj: ResolvedConfigFilePath, program: T) {
        if (host.afterProgramEmitAndDiagnostics) {
            host.afterProgramEmitAndDiagnostics(program);
        }
        if (watch) {
            program.releaseProgram();
            builderPrograms.set(proj, program);
        }
    }

    function buildErrors<T extends BuilderProgram>(
        state: SolutionBuilderState<T>,
        resolvedPath: ResolvedConfigFilePath,
        program: T | undefined,
        diagnostics: ReadonlyArray<Diagnostic>,
        errorFlags: BuildResultFlags,
        errorType: string
    ) {
        reportAndStoreErrors(state, resolvedPath, diagnostics);
        // List files if any other build error using program (emit errors already report files)
        if (program && state.writeFileName) listFiles(program, state.writeFileName);
        state.projectStatus.set(resolvedPath, { type: UpToDateStatusType.Unbuildable, reason: `${errorType} errors` });
        if (program) afterProgramCreate(state, resolvedPath, program);
        state.projectCompilerOptions = state.baseCompilerOptions;
        return errorFlags;
    }

    function updateModuleResolutionCache(
        state: SolutionBuilderState,
        proj: ResolvedConfigFileName,
        config: ParsedCommandLine
    ) {
        if (!state.moduleResolutionCache) return;

        // Update module resolution cache if needed
        const { moduleResolutionCache } = state;
        const projPath = toPath(state, proj);
        if (moduleResolutionCache.directoryToModuleNameMap.redirectsMap.size === 0) {
            // The own map will be for projectCompilerOptions
            Debug.assert(moduleResolutionCache.moduleNameToDirectoryMap.redirectsMap.size === 0);
            moduleResolutionCache.directoryToModuleNameMap.redirectsMap.set(projPath, moduleResolutionCache.directoryToModuleNameMap.ownMap);
            moduleResolutionCache.moduleNameToDirectoryMap.redirectsMap.set(projPath, moduleResolutionCache.moduleNameToDirectoryMap.ownMap);
        }
        else {
            // Set correct own map
            Debug.assert(moduleResolutionCache.moduleNameToDirectoryMap.redirectsMap.size > 0);

            const ref: ResolvedProjectReference = {
                sourceFile: config.options.configFile!,
                commandLine: config
            };
            moduleResolutionCache.directoryToModuleNameMap.setOwnMap(moduleResolutionCache.directoryToModuleNameMap.getOrCreateMapOfCacheRedirects(ref));
            moduleResolutionCache.moduleNameToDirectoryMap.setOwnMap(moduleResolutionCache.moduleNameToDirectoryMap.getOrCreateMapOfCacheRedirects(ref));
        }
        moduleResolutionCache.directoryToModuleNameMap.setOwnOptions(config.options);
        moduleResolutionCache.moduleNameToDirectoryMap.setOwnOptions(config.options);
    }

    function buildSingleProject(
        state: SolutionBuilderState,
        proj: ResolvedConfigFileName,
        resolvedPath: ResolvedConfigFilePath,
        config: ParsedCommandLine,
        cancellationToken: CancellationToken | undefined
    ): BuildResultFlags {
        if (state.options.dry) {
            reportStatus(state, Diagnostics.A_non_dry_build_would_build_project_0, proj);
            return BuildResultFlags.Success;
        }

        if (state.options.verbose) reportStatus(state, Diagnostics.Building_project_0, proj);

        if (config.fileNames.length === 0) {
            reportAndStoreErrors(state, resolvedPath, config.errors);
            // Nothing to build - must be a solution file, basically
            return BuildResultFlags.None;
        }

        const { host, projectStatus, diagnostics, compilerHost } = state;
        state.projectCompilerOptions = config.options;
        // Update module resolution cache if needed
        updateModuleResolutionCache(state, proj, config);

        // Create program
        const program = host.createProgram(
            config.fileNames,
            config.options,
            compilerHost,
            getOldProgram(state, resolvedPath, config),
            config.errors,
            config.projectReferences
        );

        // Don't emit anything in the presence of syntactic errors or options diagnostics
        const syntaxDiagnostics = [
            ...program.getConfigFileParsingDiagnostics(),
            ...program.getOptionsDiagnostics(cancellationToken),
            ...program.getGlobalDiagnostics(cancellationToken),
            ...program.getSyntacticDiagnostics(/*sourceFile*/ undefined, cancellationToken)];
        if (syntaxDiagnostics.length) {
            return buildErrors(
                state,
                resolvedPath,
                program,
                syntaxDiagnostics,
                BuildResultFlags.SyntaxErrors,
                "Syntactic"
            );
        }

        // Same as above but now for semantic diagnostics
        const semanticDiagnostics = program.getSemanticDiagnostics(/*sourceFile*/ undefined, cancellationToken);
        if (semanticDiagnostics.length) {
            return buildErrors(
                state,
                resolvedPath,
                program,
                semanticDiagnostics,
                BuildResultFlags.TypeErrors,
                "Semantic"
            );
        }

        // Before emitting lets backup state, so we can revert it back if there are declaration errors to handle emit and declaration errors correctly
        program.backupState();
        let declDiagnostics: Diagnostic[] | undefined;
        const reportDeclarationDiagnostics = (d: Diagnostic) => (declDiagnostics || (declDiagnostics = [])).push(d);
        const outputFiles: OutputFile[] = [];
        emitFilesAndReportErrors(
            program,
            reportDeclarationDiagnostics,
                /*writeFileName*/ undefined,
                /*reportSummary*/ undefined,
            (name, text, writeByteOrderMark) => outputFiles.push({ name, text, writeByteOrderMark }),
            cancellationToken
        );
        // Don't emit .d.ts if there are decl file errors
        if (declDiagnostics) {
            program.restoreState();
            return buildErrors(
                state,
                resolvedPath,
                program,
                declDiagnostics,
                BuildResultFlags.DeclarationEmitErrors,
                "Declaration file"
            );
        }

        // Actual Emit
        let resultFlags = BuildResultFlags.DeclarationOutputUnchanged;
        let newestDeclarationFileContentChangedTime = minimumDate;
        let anyDtsChanged = false;
        const emitterDiagnostics = createDiagnosticCollection();
        const emittedOutputs = createMap() as FileMap<string>;
        outputFiles.forEach(({ name, text, writeByteOrderMark }) => {
            let priorChangeTime: Date | undefined;
            if (!anyDtsChanged && isDeclarationFile(name)) {
                // Check for unchanged .d.ts files
                if (host.fileExists(name) && state.readFileWithCache(name) === text) {
                    priorChangeTime = host.getModifiedTime(name);
                }
                else {
                    resultFlags &= ~BuildResultFlags.DeclarationOutputUnchanged;
                    anyDtsChanged = true;
                }
            }

            emittedOutputs.set(toPath(state, name), name);
            writeFile(compilerHost, emitterDiagnostics, name, text, writeByteOrderMark);
            if (priorChangeTime !== undefined) {
                newestDeclarationFileContentChangedTime = newer(priorChangeTime, newestDeclarationFileContentChangedTime);
            }
        });

        const emitDiagnostics = emitterDiagnostics.getDiagnostics();
        if (emitDiagnostics.length) {
            return buildErrors(
                state,
                resolvedPath,
                program,
                emitDiagnostics,
                BuildResultFlags.EmitErrors,
                "Emit"
            );
        }

        if (state.writeFileName) {
            emittedOutputs.forEach(name => listEmittedFile(state, config, name));
            listFiles(program, state.writeFileName);
        }

        // Update time stamps for rest of the outputs
        newestDeclarationFileContentChangedTime = updateOutputTimestampsWorker(state, config, newestDeclarationFileContentChangedTime, Diagnostics.Updating_unchanged_output_timestamps_of_project_0, emittedOutputs);
        diagnostics.delete(resolvedPath);
        projectStatus.set(resolvedPath, {
            type: UpToDateStatusType.UpToDate,
            newestDeclarationFileContentChangedTime: anyDtsChanged ? maximumDate : newestDeclarationFileContentChangedTime,
            oldestOutputFileName: outputFiles.length ? outputFiles[0].name : getFirstProjectOutput(config, !host.useCaseSensitiveFileNames())
        });
        afterProgramCreate(state, resolvedPath, program);
        state.projectCompilerOptions = state.baseCompilerOptions;
        return resultFlags;
    }

    function updateBundle(
        state: SolutionBuilderState,
        proj: ResolvedConfigFileName,
        resolvedPath: ResolvedConfigFilePath,
        config: ParsedCommandLine
    ): BuildResultFlags | string {
        if (state.options.dry) {
            reportStatus(state, Diagnostics.A_non_dry_build_would_update_output_of_project_0, proj);
            return BuildResultFlags.Success;
        }

        if (state.options.verbose) reportStatus(state, Diagnostics.Updating_output_of_project_0, proj);

        // Update js, and source map
        const { projectStatus, diagnostics, compilerHost } = state;
        state.projectCompilerOptions = config.options;
        const outputFiles = emitUsingBuildInfo(
            config,
            compilerHost,
            ref => {
                const refName = resolveProjectName(state, ref.path);
                return parseConfigFile(state, refName, toResolvedConfigFilePath(state, refName));
            });
        if (isString(outputFiles)) {
            reportStatus(state, Diagnostics.Cannot_update_output_of_project_0_because_there_was_error_reading_file_1, proj, relName(state, outputFiles));
            return outputFiles;
        }

        // Actual Emit
        Debug.assert(!!outputFiles.length);
        const emitterDiagnostics = createDiagnosticCollection();
        const emittedOutputs = createMap() as FileMap<string>;
        outputFiles.forEach(({ name, text, writeByteOrderMark }) => {
            emittedOutputs.set(toPath(state, name), name);
            writeFile(compilerHost, emitterDiagnostics, name, text, writeByteOrderMark);
        });
        const emitDiagnostics = emitterDiagnostics.getDiagnostics();
        if (emitDiagnostics.length) {
            return buildErrors(
                state,
                resolvedPath,
                /*program*/ undefined,
                emitDiagnostics,
                BuildResultFlags.EmitErrors,
                "Emit"
            );
        }

        if (state.writeFileName) {
            emittedOutputs.forEach(name => listEmittedFile(state, config, name));
        }

        // Update timestamps for dts
        const newestDeclarationFileContentChangedTime = updateOutputTimestampsWorker(state, config, minimumDate, Diagnostics.Updating_unchanged_output_timestamps_of_project_0, emittedOutputs);
        diagnostics.delete(resolvedPath);
        projectStatus.set(resolvedPath, {
            type: UpToDateStatusType.UpToDate,
            newestDeclarationFileContentChangedTime,
            oldestOutputFileName: outputFiles[0].name
        });
        state.projectCompilerOptions = state.baseCompilerOptions;
        return BuildResultFlags.DeclarationOutputUnchanged;
    }

    function checkConfigFileUpToDateStatus(state: SolutionBuilderState, configFile: string, oldestOutputFileTime: Date, oldestOutputFileName: string): Status.OutOfDateWithSelf | undefined {
        // Check tsconfig time
        const tsconfigTime = state.host.getModifiedTime(configFile) || missingFileModifiedTime;
        if (oldestOutputFileTime < tsconfigTime) {
            return {
                type: UpToDateStatusType.OutOfDateWithSelf,
                outOfDateOutputFileName: oldestOutputFileName,
                newerInputFileName: configFile
            };
        }
    }

    function getUpToDateStatusWorker(state: SolutionBuilderState, project: ParsedCommandLine, resolvedPath: ResolvedConfigFilePath): UpToDateStatus {
        let newestInputFileName: string = undefined!;
        let newestInputFileTime = minimumDate;
        const { host } = state;
        // Get timestamps of input files
        for (const inputFile of project.fileNames) {
            if (!host.fileExists(inputFile)) {
                return {
                    type: UpToDateStatusType.Unbuildable,
                    reason: `${inputFile} does not exist`
                };
            }

            const inputTime = host.getModifiedTime(inputFile) || missingFileModifiedTime;
            if (inputTime > newestInputFileTime) {
                newestInputFileName = inputFile;
                newestInputFileTime = inputTime;
            }
        }

        // Container if no files are specified in the project
        if (!project.fileNames.length && !canJsonReportNoInutFiles(project.raw)) {
            return {
                type: UpToDateStatusType.ContainerOnly
            };
        }

        // Collect the expected outputs of this project
        const outputs = getAllProjectOutputs(project, !host.useCaseSensitiveFileNames());

        // Now see if all outputs are newer than the newest input
        let oldestOutputFileName = "(none)";
        let oldestOutputFileTime = maximumDate;
        let newestOutputFileName = "(none)";
        let newestOutputFileTime = minimumDate;
        let missingOutputFileName: string | undefined;
        let newestDeclarationFileContentChangedTime = minimumDate;
        let isOutOfDateWithInputs = false;
        for (const output of outputs) {
            // Output is missing; can stop checking
            // Don't immediately return because we can still be upstream-blocked, which is a higher-priority status
            if (!host.fileExists(output)) {
                missingOutputFileName = output;
                break;
            }

            const outputTime = host.getModifiedTime(output) || missingFileModifiedTime;
            if (outputTime < oldestOutputFileTime) {
                oldestOutputFileTime = outputTime;
                oldestOutputFileName = output;
            }

            // If an output is older than the newest input, we can stop checking
            // Don't immediately return because we can still be upstream-blocked, which is a higher-priority status
            if (outputTime < newestInputFileTime) {
                isOutOfDateWithInputs = true;
                break;
            }

            if (outputTime > newestOutputFileTime) {
                newestOutputFileTime = outputTime;
                newestOutputFileName = output;
            }

            // Keep track of when the most recent time a .d.ts file was changed.
            // In addition to file timestamps, we also keep track of when a .d.ts file
            // had its file touched but not had its contents changed - this allows us
            // to skip a downstream typecheck
            if (isDeclarationFile(output)) {
                const outputModifiedTime = host.getModifiedTime(output) || missingFileModifiedTime;
                newestDeclarationFileContentChangedTime = newer(newestDeclarationFileContentChangedTime, outputModifiedTime);
            }
        }

        let pseudoUpToDate = false;
        let usesPrepend = false;
        let upstreamChangedProject: string | undefined;
        if (project.projectReferences) {
            state.projectStatus.set(resolvedPath, { type: UpToDateStatusType.ComputingUpstream });
            for (const ref of project.projectReferences) {
                usesPrepend = usesPrepend || !!(ref.prepend);
                const resolvedRef = resolveProjectReferencePath(ref);
                const resolvedRefPath = toResolvedConfigFilePath(state, resolvedRef);
                const refStatus = getUpToDateStatus(state, parseConfigFile(state, resolvedRef, resolvedRefPath), resolvedRefPath);

                // Its a circular reference ignore the status of this project
                if (refStatus.type === UpToDateStatusType.ComputingUpstream) {
                    continue;
                }

                // An upstream project is blocked
                if (refStatus.type === UpToDateStatusType.Unbuildable) {
                    return {
                        type: UpToDateStatusType.UpstreamBlocked,
                        upstreamProjectName: ref.path
                    };
                }

                // If the upstream project is out of date, then so are we (someone shouldn't have asked, though?)
                if (refStatus.type !== UpToDateStatusType.UpToDate) {
                    return {
                        type: UpToDateStatusType.UpstreamOutOfDate,
                        upstreamProjectName: ref.path
                    };
                }

                // Check oldest output file name only if there is no missing output file name
                if (!missingOutputFileName) {
                    // If the upstream project's newest file is older than our oldest output, we
                    // can't be out of date because of it
                    if (refStatus.newestInputFileTime && refStatus.newestInputFileTime <= oldestOutputFileTime) {
                        continue;
                    }

                    // If the upstream project has only change .d.ts files, and we've built
                    // *after* those files, then we're "psuedo up to date" and eligible for a fast rebuild
                    if (refStatus.newestDeclarationFileContentChangedTime && refStatus.newestDeclarationFileContentChangedTime <= oldestOutputFileTime) {
                        pseudoUpToDate = true;
                        upstreamChangedProject = ref.path;
                        continue;
                    }

                    // We have an output older than an upstream output - we are out of date
                    Debug.assert(oldestOutputFileName !== undefined, "Should have an oldest output filename here");
                    return {
                        type: UpToDateStatusType.OutOfDateWithUpstream,
                        outOfDateOutputFileName: oldestOutputFileName,
                        newerProjectName: ref.path
                    };
                }
            }
        }

        if (missingOutputFileName !== undefined) {
            return {
                type: UpToDateStatusType.OutputMissing,
                missingOutputFileName
            };
        }

        if (isOutOfDateWithInputs) {
            return {
                type: UpToDateStatusType.OutOfDateWithSelf,
                outOfDateOutputFileName: oldestOutputFileName,
                newerInputFileName: newestInputFileName
            };
        }
        else {
            // Check tsconfig time
            const configStatus = checkConfigFileUpToDateStatus(state, project.options.configFilePath!, oldestOutputFileTime, oldestOutputFileName);
            if (configStatus) return configStatus;

            // Check extended config time
            const extendedConfigStatus = forEach(project.options.configFile!.extendedSourceFiles || emptyArray, configFile => checkConfigFileUpToDateStatus(state, configFile, oldestOutputFileTime, oldestOutputFileName));
            if (extendedConfigStatus) return extendedConfigStatus;
        }

        if (!state.buildInfoChecked.has(resolvedPath)) {
            state.buildInfoChecked.set(resolvedPath, true);
            const buildInfoPath = getOutputPathForBuildInfo(project.options);
            if (buildInfoPath) {
                const value = state.readFileWithCache(buildInfoPath);
                const buildInfo = value && getBuildInfo(value);
                if (buildInfo && buildInfo.version !== version) {
                    return {
                        type: UpToDateStatusType.TsVersionOutputOfDate,
                        version: buildInfo.version
                    };
                }
            }
        }

        if (usesPrepend && pseudoUpToDate) {
            return {
                type: UpToDateStatusType.OutOfDateWithPrepend,
                outOfDateOutputFileName: oldestOutputFileName,
                newerProjectName: upstreamChangedProject!
            };
        }

        // Up to date
        return {
            type: pseudoUpToDate ? UpToDateStatusType.UpToDateWithUpstreamTypes : UpToDateStatusType.UpToDate,
            newestDeclarationFileContentChangedTime,
            newestInputFileTime,
            newestOutputFileTime,
            newestInputFileName,
            newestOutputFileName,
            oldestOutputFileName
        };
    }

    function getUpToDateStatus(state: SolutionBuilderState, project: ParsedCommandLine | undefined, resolvedPath: ResolvedConfigFilePath): UpToDateStatus {
        if (project === undefined) {
            return { type: UpToDateStatusType.Unbuildable, reason: "File deleted mid-build" };
        }

        const prior = state.projectStatus.get(resolvedPath);
        if (prior !== undefined) {
            return prior;
        }

        const actual = getUpToDateStatusWorker(state, project, resolvedPath);
        state.projectStatus.set(resolvedPath, actual);
        return actual;
    }

    function updateOutputTimestampsWorker(state: SolutionBuilderState, proj: ParsedCommandLine, priorNewestUpdateTime: Date, verboseMessage: DiagnosticMessage, skipOutputs?: FileMap<string>) {
        const { host } = state;
        const outputs = getAllProjectOutputs(proj, !host.useCaseSensitiveFileNames());
        if (!skipOutputs || outputs.length !== skipOutputs.size) {
            let reportVerbose = !!state.options.verbose;
            const now = host.now ? host.now() : new Date();
            for (const file of outputs) {
                if (skipOutputs && skipOutputs.has(toPath(state, file))) {
                    continue;
                }

                if (reportVerbose) {
                    reportVerbose = false;
                    reportStatus(state, verboseMessage, proj.options.configFilePath!);
                }

                if (isDeclarationFile(file)) {
                    priorNewestUpdateTime = newer(priorNewestUpdateTime, host.getModifiedTime(file) || missingFileModifiedTime);
                }

                host.setModifiedTime(file, now);
                listEmittedFile(state, proj, file);
            }
        }

        return priorNewestUpdateTime;
    }

    function updateOutputTimestamps(state: SolutionBuilderState, proj: ParsedCommandLine, resolvedPath: ResolvedConfigFilePath) {
        if (state.options.dry) {
            return reportStatus(state, Diagnostics.A_non_dry_build_would_update_timestamps_for_output_of_project_0, proj.options.configFilePath!);
        }
        const priorNewestUpdateTime = updateOutputTimestampsWorker(state, proj, minimumDate, Diagnostics.Updating_output_timestamps_of_project_0);
        state.projectStatus.set(resolvedPath, {
            type: UpToDateStatusType.UpToDate,
            newestDeclarationFileContentChangedTime: priorNewestUpdateTime,
            oldestOutputFileName: getFirstProjectOutput(proj, !state.host.useCaseSensitiveFileNames())
        });
    }

    function queueReferencingProjects(
        state: SolutionBuilderState,
        project: ResolvedConfigFileName,
        projectPath: ResolvedConfigFilePath,
        projectIndex: number,
        config: ParsedCommandLine,
        buildOrder: readonly ResolvedConfigFileName[],
        buildResult: BuildResultFlags
    ) {
        // Queue only if there are no errors
        if (buildResult & BuildResultFlags.AnyErrors) return;
        // Only composite projects can be referenced by other projects
        if (!config.options.composite) return;
        // Always use build order to queue projects
        for (let index = projectIndex + 1; index < buildOrder.length; index++) {
            const nextProject = buildOrder[index];
            const nextProjectPath = toResolvedConfigFilePath(state, nextProject);
            if (state.projectPendingBuild.has(nextProjectPath)) continue;

            const nextProjectConfig = parseConfigFile(state, nextProject, nextProjectPath);
            if (!nextProjectConfig || !nextProjectConfig.projectReferences) continue;
            for (const ref of nextProjectConfig.projectReferences) {
                const resolvedRefPath = resolveProjectName(state, ref.path);
                if (toResolvedConfigFilePath(state, resolvedRefPath) !== projectPath) continue;
                // If the project is referenced with prepend, always build downstream projects,
                // If declaration output is changed, build the project
                // otherwise mark the project UpToDateWithUpstreamTypes so it updates output time stamps
                const status = state.projectStatus.get(nextProjectPath);
                if (status) {
                    switch (status.type) {
                        case UpToDateStatusType.UpToDate:
                            if (buildResult & BuildResultFlags.DeclarationOutputUnchanged) {
                                if (ref.prepend) {
                                    state.projectStatus.set(nextProjectPath, {
                                        type: UpToDateStatusType.OutOfDateWithPrepend,
                                        outOfDateOutputFileName: status.oldestOutputFileName,
                                        newerProjectName: project
                                    });
                                }
                                else {
                                    status.type = UpToDateStatusType.UpToDateWithUpstreamTypes;
                                }
                                break;
                            }

                        // falls through
                        case UpToDateStatusType.UpToDateWithUpstreamTypes:
                        case UpToDateStatusType.OutOfDateWithPrepend:
                            if (!(buildResult & BuildResultFlags.DeclarationOutputUnchanged)) {
                                state.projectStatus.set(nextProjectPath, {
                                    type: UpToDateStatusType.OutOfDateWithUpstream,
                                    outOfDateOutputFileName: status.type === UpToDateStatusType.OutOfDateWithPrepend ? status.outOfDateOutputFileName : status.oldestOutputFileName,
                                    newerProjectName: project
                                });
                            }
                            break;

                        case UpToDateStatusType.UpstreamBlocked:
                            if (toResolvedConfigFilePath(state, resolveProjectName(state, status.upstreamProjectName)) === projectPath) {
                                clearProjectStatus(state, nextProjectPath);
                            }
                            break;
                    }
                }
                addProjToQueue(state, nextProjectPath, ConfigFileProgramReloadLevel.None);
                break;
            }
        }
    }

    function buildNextProject(state: SolutionBuilderState, cancellationToken?: CancellationToken): SolutionBuilderResult<ExitStatus> | undefined {
        setupInitialBuild(state, cancellationToken);
        const invalidatedProject = getNextInvalidatedProject(state, getBuildOrder(state));
        if (!invalidatedProject) return undefined;

        invalidatedProject.done(cancellationToken);
        return {
            project: invalidatedProject.project,
            result: state.diagnostics.has(invalidatedProject.projectPath) ?
                ExitStatus.DiagnosticsPresent_OutputsSkipped :
                ExitStatus.Success
        };
    }

    function build(state: SolutionBuilderState, project?: string, cancellationToken?: CancellationToken): ExitStatus {
        const buildOrder = getBuildOrderFor(state, project);
        if (!buildOrder) return ExitStatus.InvalidProject_OutputsSkipped;

        setupInitialBuild(state, cancellationToken);

        let successfulProjects = 0;
        let errorProjects = 0;
        while (true) {
            const invalidatedProject = getNextInvalidatedProject(state, buildOrder);
            if (!invalidatedProject) break;
            invalidatedProject.done(cancellationToken);
            if (state.diagnostics.has(invalidatedProject.projectPath)) {
                errorProjects++;
            }
            else {
                successfulProjects++;
            }
        }

        disableCache(state);
        reportErrorSummary(state);
        startWatching(state);

        return errorProjects ?
            successfulProjects ?
                ExitStatus.DiagnosticsPresent_OutputsGenerated :
                ExitStatus.DiagnosticsPresent_OutputsSkipped :
            ExitStatus.Success;
    }

    function clean(state: SolutionBuilderState, project?: string) {
        const buildOrder = getBuildOrderFor(state, project);
        if (!buildOrder) return ExitStatus.InvalidProject_OutputsSkipped;

        const { options, host } = state;
        const filesToDelete = options.dry ? [] as string[] : undefined;
        for (const proj of buildOrder) {
            const resolvedPath = toResolvedConfigFilePath(state, proj);
            const parsed = parseConfigFile(state, proj, resolvedPath);
            if (parsed === undefined) {
                // File has gone missing; fine to ignore here
                reportParseConfigFileDiagnostic(state, resolvedPath);
                continue;
            }
            const outputs = getAllProjectOutputs(parsed, !host.useCaseSensitiveFileNames());
            for (const output of outputs) {
                if (host.fileExists(output)) {
                    if (filesToDelete) {
                        filesToDelete.push(output);
                    }
                    else {
                        host.deleteFile(output);
                        invalidateProject(state, resolvedPath, ConfigFileProgramReloadLevel.None);
                    }
                }
            }
        }

        if (filesToDelete) {
            reportStatus(state, Diagnostics.A_non_dry_build_would_delete_the_following_files_Colon_0, filesToDelete.map(f => `\r\n * ${f}`).join(""));
        }

        return ExitStatus.Success;
    }

    function invalidateProject(state: SolutionBuilderState, resolved: ResolvedConfigFilePath, reloadLevel: ConfigFileProgramReloadLevel) {
        if (reloadLevel === ConfigFileProgramReloadLevel.Full) {
            state.configFileCache.delete(resolved);
            state.buildOrder = undefined;
        }
        state.needsSummary = true;
        clearProjectStatus(state, resolved);
        addProjToQueue(state, resolved, reloadLevel);
        enableCache(state);
    }

    function invalidateProjectAndScheduleBuilds(state: SolutionBuilderState, resolvedPath: ResolvedConfigFilePath, reloadLevel: ConfigFileProgramReloadLevel) {
        state.reportFileChangeDetected = true;
        invalidateProject(state, resolvedPath, reloadLevel);
        scheduleBuildInvalidatedProject(state);
    }

    function scheduleBuildInvalidatedProject(state: SolutionBuilderState) {
        const { hostWithWatch } = state;
        if (!hostWithWatch.setTimeout || !hostWithWatch.clearTimeout) {
            return;
        }
        if (state.timerToBuildInvalidatedProject) {
            hostWithWatch.clearTimeout(state.timerToBuildInvalidatedProject);
        }
        state.timerToBuildInvalidatedProject = hostWithWatch.setTimeout(buildNextInvalidatedProject, 250, state);
    }

    function buildNextInvalidatedProject(state: SolutionBuilderState) {
        state.timerToBuildInvalidatedProject = undefined;
        if (state.reportFileChangeDetected) {
            state.reportFileChangeDetected = false;
            state.projectErrorsReported.clear();
            reportWatchStatus(state, Diagnostics.File_change_detected_Starting_incremental_compilation);
        }
        const invalidatedProject = getNextInvalidatedProject(state, getBuildOrder(state));
        if (invalidatedProject) {
            invalidatedProject.done();
            if (state.projectPendingBuild.size) {
                // Schedule next project for build
                if (state.watch && !state.timerToBuildInvalidatedProject) {
                    scheduleBuildInvalidatedProject(state);
                }
                return;
            }
        }
        disableCache(state);
        reportErrorSummary(state);
    }

    function watchConfigFile(state: SolutionBuilderState, resolved: ResolvedConfigFileName, resolvedPath: ResolvedConfigFilePath) {
        if (!state.watch || state.allWatchedConfigFiles.has(resolvedPath)) return;
        state.allWatchedConfigFiles.set(resolvedPath, state.watchFile(
            state.hostWithWatch,
            resolved,
            () => {
                invalidateProjectAndScheduleBuilds(state, resolvedPath, ConfigFileProgramReloadLevel.Full);
            },
            PollingInterval.High,
            WatchType.ConfigFile,
            resolved
        ));
    }

    function isSameFile(state: SolutionBuilderState, file1: string, file2: string) {
        return comparePaths(file1, file2, state.currentDirectory, !state.host.useCaseSensitiveFileNames()) === Comparison.EqualTo;
    }

    function isOutputFile(state: SolutionBuilderState, fileName: string, configFile: ParsedCommandLine) {
        if (configFile.options.noEmit) return false;

        // ts or tsx files are not output
        if (!fileExtensionIs(fileName, Extension.Dts) &&
            (fileExtensionIs(fileName, Extension.Ts) || fileExtensionIs(fileName, Extension.Tsx))) {
            return false;
        }

        // If options have --outFile or --out, check if its that
        const out = configFile.options.outFile || configFile.options.out;
        if (out && (isSameFile(state, fileName, out) || isSameFile(state, fileName, removeFileExtension(out) + Extension.Dts))) {
            return true;
        }

        // If declarationDir is specified, return if its a file in that directory
        if (configFile.options.declarationDir && containsPath(configFile.options.declarationDir, fileName, state.currentDirectory, !state.host.useCaseSensitiveFileNames())) {
            return true;
        }

        // If --outDir, check if file is in that directory
        if (configFile.options.outDir && containsPath(configFile.options.outDir, fileName, state.currentDirectory, !state.host.useCaseSensitiveFileNames())) {
            return true;
        }

        return !forEach(configFile.fileNames, inputFile => isSameFile(state, fileName, inputFile));
    }

    function watchWildCardDirectories(state: SolutionBuilderState, resolved: ResolvedConfigFileName, resolvedPath: ResolvedConfigFilePath, parsed: ParsedCommandLine) {
        if (!state.watch) return;
        updateWatchingWildcardDirectories(
            getOrCreateValueMapFromConfigFileMap(state.allWatchedWildcardDirectories, resolvedPath),
            createMapFromTemplate(parsed.configFileSpecs!.wildcardDirectories),
            (dir, flags) => state.watchDirectory(
                state.hostWithWatch,
                dir,
                fileOrDirectory => {
                    const fileOrDirectoryPath = toPath(state, fileOrDirectory);
                    if (fileOrDirectoryPath !== toPath(state, dir) && hasExtension(fileOrDirectoryPath) && !isSupportedSourceFileName(fileOrDirectory, parsed.options)) {
                        state.writeLog(`Project: ${resolved} Detected file add/remove of non supported extension: ${fileOrDirectory}`);
                        return;
                    }

                    if (isOutputFile(state, fileOrDirectory, parsed)) {
                        state.writeLog(`${fileOrDirectory} is output file`);
                        return;
                    }

                    invalidateProjectAndScheduleBuilds(state, resolvedPath, ConfigFileProgramReloadLevel.Partial);
                },
                flags,
                WatchType.WildcardDirectory,
                resolved
            )
        );
    }

    function watchInputFiles(state: SolutionBuilderState, resolved: ResolvedConfigFileName, resolvedPath: ResolvedConfigFilePath, parsed: ParsedCommandLine) {
        if (!state.watch) return;
        mutateMap(
            getOrCreateValueMapFromConfigFileMap(state.allWatchedInputFiles, resolvedPath),
            arrayToMap(parsed.fileNames, fileName => toPath(state, fileName)),
            {
                createNewValue: (path, input) => state.watchFilePath(
                    state.hostWithWatch,
                    input,
                    () => invalidateProjectAndScheduleBuilds(state, resolvedPath, ConfigFileProgramReloadLevel.None),
                    PollingInterval.Low,
                    path as Path,
                    WatchType.SourceFile,
                    resolved
                ),
                onDeleteValue: closeFileWatcher,
            }
        );
    }

    function startWatching(state: SolutionBuilderState) {
        if (!state.watchAllProjectsPending) return;
        state.watchAllProjectsPending = false;
        for (const resolved of getBuildOrder(state)) {
            const resolvedPath = toResolvedConfigFilePath(state, resolved);
            // Watch this file
            watchConfigFile(state, resolved, resolvedPath);

            const cfg = parseConfigFile(state, resolved, resolvedPath);
            if (cfg) {
                // Update watchers for wildcard directories
                watchWildCardDirectories(state, resolved, resolvedPath, cfg);

                // Watch input files
                watchInputFiles(state, resolved, resolvedPath, cfg);
            }
        }
    }

    /**
     * A SolutionBuilder has an immutable set of rootNames that are the "entry point" projects, but
     * can dynamically add/remove other projects based on changes on the rootNames' references
     */
    function createSolutionBuilderWorker<T extends BuilderProgram>(watch: false, host: SolutionBuilderHost<T>, rootNames: ReadonlyArray<string>, defaultOptions: BuildOptions): SolutionBuilder;
    function createSolutionBuilderWorker<T extends BuilderProgram>(watch: true, host: SolutionBuilderWithWatchHost<T>, rootNames: ReadonlyArray<string>, defaultOptions: BuildOptions): SolutionBuilder;
    function createSolutionBuilderWorker<T extends BuilderProgram>(watch: boolean, hostOrHostWithWatch: SolutionBuilderHost<T> | SolutionBuilderWithWatchHost<T>, rootNames: ReadonlyArray<string>, options: BuildOptions): SolutionBuilder {
        const state = createSolutionBuilderState(watch, hostOrHostWithWatch, rootNames, options);
        return {
            build: (project, cancellationToken) => build(state, project, cancellationToken),
            clean: project => clean(state, project),
            buildNextProject: cancellationToken => buildNextProject(state, cancellationToken),
            getBuildOrder: () => getBuildOrder(state),
            getUpToDateStatusOfProject: project => {
                const configFileName = resolveProjectName(state, project);
                const configFilePath = toResolvedConfigFilePath(state, configFileName);
                return getUpToDateStatus(state, parseConfigFile(state, configFileName, configFilePath), configFilePath);
            },
            invalidateProject: (configFilePath, reloadLevel) => invalidateProject(state, configFilePath, reloadLevel || ConfigFileProgramReloadLevel.None),
            buildNextInvalidatedProject: () => buildNextInvalidatedProject(state),
        };
    }

    function relName(state: SolutionBuilderState, path: string): string {
        return convertToRelativePath(path, state.currentDirectory, f => state.getCanonicalFileName(f));
    }

    function reportStatus(state: SolutionBuilderState, message: DiagnosticMessage, ...args: string[]) {
        state.host.reportSolutionBuilderStatus(createCompilerDiagnostic(message, ...args));
    }

    function reportWatchStatus(state: SolutionBuilderState, message: DiagnosticMessage, ...args: (string | number | undefined)[]) {
        if (state.hostWithWatch.onWatchStatusChange) {
            state.hostWithWatch.onWatchStatusChange(createCompilerDiagnostic(message, ...args), state.host.getNewLine(), state.baseCompilerOptions);
        }
    }

    function reportErrors({ host }: SolutionBuilderState, errors: ReadonlyArray<Diagnostic>) {
        errors.forEach(err => host.reportDiagnostic(err));
    }

    function reportAndStoreErrors(state: SolutionBuilderState, proj: ResolvedConfigFilePath, errors: ReadonlyArray<Diagnostic>) {
        reportErrors(state, errors);
        state.projectErrorsReported.set(proj, true);
        if (errors.length) {
            state.diagnostics.set(proj, errors);
        }
    }

    function reportParseConfigFileDiagnostic(state: SolutionBuilderState, proj: ResolvedConfigFilePath) {
        reportAndStoreErrors(state, proj, [state.configFileCache.get(proj) as Diagnostic]);
    }

    function reportErrorSummary(state: SolutionBuilderState) {
        if (!state.needsSummary || (!state.watch && !state.host.reportErrorSummary)) return;
        state.needsSummary = false;
        const { diagnostics } = state;
        // Report errors from the other projects
        getBuildOrder(state).forEach(project => {
            const projectPath = toResolvedConfigFilePath(state, project);
            if (!state.projectErrorsReported.has(projectPath)) {
                reportErrors(state, diagnostics.get(projectPath) || emptyArray);
            }
        });
        let totalErrors = 0;
        diagnostics.forEach(singleProjectErrors => totalErrors += getErrorCountForSummary(singleProjectErrors));
        if (state.watch) {
            reportWatchStatus(state, getWatchErrorSummaryDiagnosticMessage(totalErrors), totalErrors);
        }
        else {
            state.host.reportErrorSummary!(totalErrors);
        }
    }

    /**
     * Report the build ordering inferred from the current project graph if we're in verbose mode
     */
    function reportBuildQueue(state: SolutionBuilderState, buildQueue: readonly ResolvedConfigFileName[]) {
        if (state.options.verbose) {
            reportStatus(state, Diagnostics.Projects_in_this_build_Colon_0, buildQueue.map(s => "\r\n    * " + relName(state, s)).join(""));
        }
    }

    function reportUpToDateStatus(state: SolutionBuilderState, configFileName: string, status: UpToDateStatus) {
        switch (status.type) {
            case UpToDateStatusType.OutOfDateWithSelf:
                return reportStatus(
                    state,
                    Diagnostics.Project_0_is_out_of_date_because_oldest_output_1_is_older_than_newest_input_2,
                    relName(state, configFileName),
                    relName(state, status.outOfDateOutputFileName),
                    relName(state, status.newerInputFileName)
                );
            case UpToDateStatusType.OutOfDateWithUpstream:
                return reportStatus(
                    state,
                    Diagnostics.Project_0_is_out_of_date_because_oldest_output_1_is_older_than_newest_input_2,
                    relName(state, configFileName),
                    relName(state, status.outOfDateOutputFileName),
                    relName(state, status.newerProjectName)
                );
            case UpToDateStatusType.OutputMissing:
                return reportStatus(
                    state,
                    Diagnostics.Project_0_is_out_of_date_because_output_file_1_does_not_exist,
                    relName(state, configFileName),
                    relName(state, status.missingOutputFileName)
                );
            case UpToDateStatusType.UpToDate:
                if (status.newestInputFileTime !== undefined) {
                    return reportStatus(
                        state,
                        Diagnostics.Project_0_is_up_to_date_because_newest_input_1_is_older_than_oldest_output_2,
                        relName(state, configFileName),
                        relName(state, status.newestInputFileName || ""),
                        relName(state, status.oldestOutputFileName || "")
                    );
                }
                // Don't report anything for "up to date because it was already built" -- too verbose
                break;
            case UpToDateStatusType.OutOfDateWithPrepend:
                return reportStatus(
                    state,
                    Diagnostics.Project_0_is_out_of_date_because_output_of_its_dependency_1_has_changed,
                    relName(state, configFileName),
                    relName(state, status.newerProjectName)
                );
            case UpToDateStatusType.UpToDateWithUpstreamTypes:
                return reportStatus(
                    state,
                    Diagnostics.Project_0_is_up_to_date_with_d_ts_files_from_its_dependencies,
                    relName(state, configFileName)
                );
            case UpToDateStatusType.UpstreamOutOfDate:
                return reportStatus(
                    state,
                    Diagnostics.Project_0_is_out_of_date_because_its_dependency_1_is_out_of_date,
                    relName(state, configFileName),
                    relName(state, status.upstreamProjectName)
                );
            case UpToDateStatusType.UpstreamBlocked:
                return reportStatus(
                    state,
                    Diagnostics.Project_0_can_t_be_built_because_its_dependency_1_has_errors,
                    relName(state, configFileName),
                    relName(state, status.upstreamProjectName)
                );
            case UpToDateStatusType.Unbuildable:
                return reportStatus(
                    state,
                    Diagnostics.Failed_to_parse_file_0_Colon_1,
                    relName(state, configFileName),
                    status.reason
                );
            case UpToDateStatusType.TsVersionOutputOfDate:
                return reportStatus(
                    state,
                    Diagnostics.Project_0_is_out_of_date_because_output_for_it_was_generated_with_version_1_that_differs_with_current_version_2,
                    relName(state, configFileName),
                    status.version,
                    version
                );
            case UpToDateStatusType.ContainerOnly:
            // Don't report status on "solution" projects
            case UpToDateStatusType.ComputingUpstream:
                // Should never leak from getUptoDateStatusWorker
                break;
            default:
                assertType<never>(status);
        }
    }

    /**
     * Report the up-to-date status of a project if we're in verbose mode
     */
    function verboseReportProjectStatus(state: SolutionBuilderState, configFileName: string, status: UpToDateStatus) {
        if (state.options.verbose) {
            reportUpToDateStatus(state, configFileName, status);
        }
    }
}
