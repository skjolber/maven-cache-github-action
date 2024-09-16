import * as core from "@actions/core";
import * as glob from "@actions/glob";
import { HttpClient, HttpClientResponse } from "@actions/http-client";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as stream from "stream";
import * as util from "util";

import { M2Path } from "./../constants";
import * as utils from "./actionUtils";
import { SocketTimeout } from "./constants";
import { retryHttpClientResponse } from "./requestUtils";

export async function downloadCacheHttpClient(
    archiveLocation: string,
    archivePath: string
): Promise<void> {
    const writeStream = fs.createWriteStream(archivePath);
    const httpClient = new HttpClient("actions/cache");
    const downloadResponse = await retryHttpClientResponse(
        "downloadCache",
        async () => httpClient.get(archiveLocation)
    );

    // Abort download if no traffic received over the socket.
    downloadResponse.message.socket.setTimeout(SocketTimeout, () => {
        downloadResponse.message.destroy();
        core.debug(
            `Aborting download, socket timed out after ${SocketTimeout} ms`
        );
    });

    await pipeResponseToStream(downloadResponse, writeStream);
}

/**
 * Pipes the body of a HTTP response to a stream
 *
 * @param response the HTTP response
 * @param output the writable stream
 */
async function pipeResponseToStream(
    response: HttpClientResponse,
    output: NodeJS.WritableStream
): Promise<void> {
    const pipeline = util.promisify(stream.pipeline);
    await pipeline(response.message, output);
}

export async function prepareCleanup(): Promise<void> {
    console.log("Prepare for cleanup of Maven cache..");

    const mavenDirectory = utils.ensureMavenDirectoryExists();

    const path = mavenDirectory + "/agent-1.0.0.jar";
    if (!fs.existsSync(path)) {
        await downloadCacheHttpClient(
            "https://repo1.maven.org/maven2/com/github/skjolber/maven-pom-recorder/agent/1.0.0/agent-1.0.0.jar",
            path
        );
    }
    if (fs.existsSync(path)) {
        const mavenrc = os.homedir() + "/.mavenrc";
        const command = `export MAVEN_OPTS="$MAVEN_OPTS -javaagent:${path}"\n`;
        fs.appendFileSync(mavenrc, command);
    } else {
        console.log("Unable to prepare cleanup");
    }
}

async function findPoms(paths: Array<string>): Promise<Set<string>> {
    const buildFiles = new Set<string>();

    for (const path of paths) {
        const globber = await glob.create(path + "/**/*.pom", {
            followSymbolicLinks: false
        });
        for await (const file of globber.globGenerator()) {
            buildFiles.add(file);
        }
    }
    return buildFiles;
}

export async function removeResolutionAttempts(
    paths: Array<string>
): Promise<void> {
    console.log("Remove resolution attempts..");
    for (const path of paths) {
        const globber = await glob.create(path + "/**/*.lastUpdated", {
            followSymbolicLinks: false
        });
        for await (const file of globber.globGenerator()) {
            fs.unlinkSync(file);
        }
    }
}

export async function performCleanup(paths: Array<string>): Promise<void> {
    const pomsInUse = new Set<string>();

    const m2 = utils.toAbsolutePath(M2Path);
    fs.readdirSync(utils.toAbsolutePath(M2Path)).forEach(file => {
        const fileName = path.basename(file);
        if (
            fileName.startsWith("maven-pom-recorder-poms-") &&
            fileName.endsWith(".txt")
        ) {
            console.log("Read file " + file);
            const poms = fs
                .readFileSync(m2 + "/" + file, { encoding: "utf8", flag: "r" })
                .split("\n")
                .map(s => s.trim())
                .filter(x => x !== "");

            poms.forEach(item => pomsInUse.add(item));
        }
    });

    if (pomsInUse.size > 0) {
        console.log("Perform cleanup of Maven cache..");

        const poms = await findPoms(paths);

        console.log(
            "Found " +
                poms.size +
                " cached artifacts, of which " +
                pomsInUse.size +
                " are in use"
        );

        for (const pom of pomsInUse) {
            poms.delete(pom);
        }

        console.log(
            "Delete " +
                poms.size +
                " cached artifacts which are no longer in use."
        );

        for (const pom of poms) {
            const parent = path.dirname(pom);
            console.log("Delete directory " + parent);
            if (!fs.existsSync(parent)) {
                console.log("Parent does not exist");
            }

            fs.rmdirSync(parent, { recursive: true });

            if (fs.existsSync(parent)) {
                console.log("Parent exists");
            }
        }
    } else {
        console.log("Cache cleanup not necessary.");
    }
}
