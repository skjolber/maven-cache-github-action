import * as core from "@actions/core";
import * as fs from "fs";
import * as os from "os";

import {
    CacheClearSearchString,
    M2RepositoryPath,
    Outputs,
    RefKey,
    Restore
} from "../constants";

export function isGhes(): boolean {
    const ghUrl = new URL(
        process.env["GITHUB_SERVER_URL"] || "https://github.com"
    );
    return ghUrl.hostname.toUpperCase() !== "GITHUB.COM";
}

export function isExactKeyMatch(key: string, cacheKey?: string): boolean {
    return !!(
        cacheKey &&
        cacheKey.localeCompare(key, undefined, {
            sensitivity: "accent"
        }) === 0
    );
}

export function setCacheRestoreOutput(result: Restore): void {
    core.setOutput(Outputs.CacheRestore, result.toString());
}

export function logWarning(message: string): void {
    const warningPrefix = "[warning]";
    core.info(`${warningPrefix}${message}`);
}

// Cache token authorized for all events that are tied to a ref
// See GitHub Context https://help.github.com/actions/automating-your-workflow-with-github-actions/contexts-and-expression-syntax-for-github-actions#github-context
export function isValidEvent(): boolean {
    return RefKey in process.env && Boolean(process.env[RefKey]);
}

export function toAbsolutePath(path: string): string {
    if (path[0] === "~") {
        path = os.homedir() + path.slice(1);
    }
    return path;
}

export function ensureMavenDirectoryExists(): string {
    const mavenDirectory = toAbsolutePath(M2RepositoryPath);
    if (!fs.existsSync(mavenDirectory)) {
        fs.mkdirSync(mavenDirectory, { recursive: true });
    }
    return mavenDirectory;
}

export function getOptionalInputAsString(
    name: string,
    defaultValue: string
): string {
    const x = core.getInput(name, { required: false }).trim();
    if (x !== "") {
        return x;
    }
    return defaultValue;
}

export function searchCommitMessages(
    commmitHashMessages: Array<string>
): number {
    for (let i = 0; i < commmitHashMessages.length; i++) {
        if (commmitHashMessages[i].includes(CacheClearSearchString)) {
            return i;
        }
    }
    return -1;
}

export function getOptionalInputAsStringArray(
    name: string,
    defaultValue: Array<string>
): string[] {
    const value = core
        .getInput(name, { required: false })
        .split("\n")
        .map(s => s.trim())
        .filter(x => x !== "");
    if (value.length > 0) {
        return value;
    }
    return defaultValue;
}

export function getInputAsArray(
    name: string,
    options?: core.InputOptions
): string[] {
    return core
        .getInput(name, options)
        .split("\n")
        .map(s => s.trim())
        .filter(x => x !== "");
}

export function getInputAsInt(
    name: string,
    options?: core.InputOptions
): number | undefined {
    const value = parseInt(core.getInput(name, options));
    if (isNaN(value) || value < 0) {
        return undefined;
    }
    return value;
}

export function getInputAsBool(
    name: string,
    options?: core.InputOptions
): boolean {
    const result = core.getInput(name, options);
    return result.toLowerCase() === "true";
}
