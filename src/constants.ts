export const MaxCacheKeys = 10;
export const CacheClearSearchString = "[cache clear]";
export const BuildFilesSearch = ["**/pom.xml"];
export const M2Path = "~/.m2";
export const M2RepositoryPath = "~/.m2/repository";
export const CachePaths = [M2RepositoryPath];
export const DefaultGitHistoryDepth = 100;
export const RestoreKeyPath = M2Path + "/cache-restore-key-success";

export enum Inputs {
    Step = "step",
    Depth = "depth",
    UploadChunkSize = "upload-chunk-size", // Input for cache, save action
    EnableCrossOsArchive = "enableCrossOsArchive" // Input for cache, restore, save action
}

export enum Outputs {
    CacheRestore = "cache-restore"
}

export enum State {
    Step = "STEP",
    FailureHash = "FAILUREHASH",
    UploadChunkSize = "UPLOADCHUNKSIZE"
}

export enum BuildSystems {
    Maven = "maven"
}

export enum Events {
    Key = "GITHUB_EVENT_NAME",
    Push = "push",
    PullRequest = "pull_request"
}

export enum Restore {
    Full = "full",
    Partial = "partial",
    None = "none"
}

export const RefKey = "GITHUB_REF";
