import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as crypto from "crypto";
import * as glob from "@actions/glob";
import { HttpClient, HttpClientResponse } from "@actions/http-client";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as stream from "stream";
import * as util from "util";

import { Inputs, M2Path, MavenWrapperPath, MavenWrapperPropertiesPath, RestoreWrapperKeyPath } from "./../constants";
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

// although this function does not clean up anything, we still need to save the cache since there might be new additions
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

        if(poms.size > 0) {
          console.log(
              "Delete " +
                  poms.size +
                  " cached artifacts which are no longer in use."
          );

          for (const pom of poms) {
              const parent = path.dirname(pom);
              console.log("Delete directory " + parent);
              if (!fs.existsSync(parent)) {
                  console.log("Parent unexpectedly does not exist");
              }

              fs.rmSync(parent, { recursive: true });

              if (fs.existsSync(parent)) {
                  console.log("Parent unexpectedly still exists");
              }
          }
        }
    } else {
        console.log("Cache cleanup not necessary.");
    }
}


export async function getFileHash(files: Array<string>) {
  const result = crypto.createHash("sha256");
  for (const file of files) {
      const hash = crypto.createHash("sha256");
      const pipeline = util.promisify(stream.pipeline);
      await pipeline(fs.createReadStream(file), hash);
      result.write(hash.digest());
  }
  result.end();

  return result.digest("hex");
}

export async function saveWrapperCache() {
  // simple file-hash based wrapper cache

  const key = loadWrapperCacheKey();
  if (key) {
      if (utils.isMavenWrapperDirectory()) {
          const enableCrossOsArchive = utils.getInputAsBool(
              Inputs.EnableCrossOsArchive
          );

          try {
              console.log("Saving Maven wrapper..");
              const result = await cache.saveCache(
                  [MavenWrapperPath],
                  key,
                  {
                      uploadChunkSize: utils.getInputAsInt(
                          Inputs.UploadChunkSize
                      )
                  },
                  enableCrossOsArchive
              );
              console.log("Saved Maven wrapper.");
              return result;
          } catch (err) {
              const error = err as Error;
              if (error.name === cache.ValidationError.name) {
                  throw error;
              } else if (error.name === cache.ReserveCacheError.name) {
                  core.info(error.message);
              } else {
                  utils.logWarning(error.message);
              }
              console.log("Unable to save maven wrapper.");
          }
      } else {
          console.log(
              "Not saving Maven wrapper, directory " +
                  MavenWrapperPath +
                  " does not exist."
          );
      }
  } else {
      console.log("Not saving Maven wrapper");
  }
  return undefined;
}

export async function restoreWrapperCache() {
  // simple file-hash based wrapper cache

  const files = await findFiles([MavenWrapperPropertiesPath]);
  if (files.length > 0) {
      const hash = await getFileHash(files);

      const enableCrossOsArchive = utils.getInputAsBool(
          Inputs.EnableCrossOsArchive
      );

      const cacheKeyPrefix = utils.getCacheKeyPrefix();

      const key = cacheKeyPrefix + "-wrapper-" + hash;

      console.log("Restoring Maven wrapper..");
      const cacheKey = await cache.restoreCache(
          [MavenWrapperPath],
          key,
          [],
          { lookupOnly: false },
          enableCrossOsArchive
      );

      if (cacheKey) {
          console.log("Maven wrapper restored successfully");

          return cacheKey;
      }
      console.log("Unable to restore Maven wrapper, cache miss.");

      // save wrapper once build completes
      saveWrapperCacheKey(key);
  } else {
      console.log(
          "Not restoring Maven wrapper, no files fount for " +
              MavenWrapperPropertiesPath +
              "."
      );
  }
  return undefined;
}

const loadWrapperCacheKey = function () {
  const absolutePath = utils.toAbsolutePath(RestoreWrapperKeyPath);
  if (fs.existsSync(absolutePath)) {
      //file exists
      const key = fs.readFileSync(absolutePath, {
          encoding: "utf8",
          flag: "r"
      });
      return key;
  }
  return undefined;
};

const saveWrapperCacheKey = function (value: string) {
  utils.ensureMavenDirectoryExists();
  console.log("If build is successful, save wrapper to key " + value);
  fs.writeFileSync(utils.toAbsolutePath(RestoreWrapperKeyPath), value);
};

export async function findFiles(matchPatterns: Array<string>): Promise<Array<string>> {
  const buildFiles = new Array<string>();

  let followSymbolicLinks = false;
  if (process.env.followSymbolicLinks === "true") {
      console.log("Follow symbolic links");
      followSymbolicLinks = true;
  }

  const githubWorkspace = process.cwd();
  const prefix = `${githubWorkspace}${path.sep}`;

  for (const matchPattern of matchPatterns) {
      const globber = await glob.create(matchPattern, {
          followSymbolicLinks: followSymbolicLinks
      });
      for await (const file of globber.globGenerator()) {
          if (!file.startsWith(prefix)) {
              console.log(
                  `Ignore '${file}' since it is not under GITHUB_WORKSPACE.`
              );
              continue;
          }
          if (fs.statSync(file).isDirectory()) {
              console.log(`Skip directory '${file}'.`);
              continue;
          }

          buildFiles.push(file);
      }
  }
  return buildFiles;
}
