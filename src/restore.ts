import * as cache from "@actions/cache";
import * as glob from '@actions/glob'
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as io from "@actions/io";
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import * as util from 'util'
import * as stream from 'stream'
import * as os from 'os'

import { Restore, Events, Inputs, State, MaxCacheKeys, BuildFilesSearch, CachePaths, M2Path, DefaultGitHistoryDepth, RestoreKeyPath} from "./constants";
import * as utils from "./utils/actionUtils";
import * as maven from "./utils/maven";

class GitOutput {
  standardOut : string;
  errorOut : string;

  constructor(standardOut : string, errorOut : string) {
    this.standardOut = standardOut;
    this.errorOut = errorOut;
  }

  getStandardOut() {
    return this.standardOut;
  }

  getErrorOut() {
    return this.errorOut;
  }

  standardOutAsString() {
    return this.standardOut.trim()
  }

  standardOutAsStringArray() {
    return this.standardOut.split("\n")
    .map(s => s.trim())
    .filter(x => x !== "");
  }

}

async function runGitCommand(parameters : Array<string>) : Promise<GitOutput> {
  let standardOut = '';
  let errorOut = '';

  await exec.exec('git', parameters, {
      silent: true,
      failOnStdErr: false,
      ignoreReturnCode: false,
      listeners: {
          stdout: (data: Buffer) => {
              standardOut += data.toString();
          },
          stderr: (data: Buffer) => {
              errorOut += data.toString();
          }
      }
  });

  return new GitOutput(standardOut, errorOut);
}

async function findFiles(matchPatterns : Array<string>) : Promise<Array<string>> {
    let buildFiles = new Array<string>();

    let followSymbolicLinks = false
    if (process.env.followSymbolicLinks === 'true') {
        console.log('Follow symbolic links')
        followSymbolicLinks = true
    }

    const githubWorkspace = process.cwd()
    const prefix = `${githubWorkspace}${path.sep}`

    for (var matchPattern of matchPatterns) {
        const globber = await glob.create(matchPattern, {followSymbolicLinks : followSymbolicLinks})
        for await (const file of globber.globGenerator()) {
            if (!file.startsWith(prefix)) {
              console.log(`Ignore '${file}' since it is not under GITHUB_WORKSPACE.`)
              continue
            }
            if (fs.statSync(file).isDirectory()) {
              console.log(`Skip directory '${file}'.`)
              continue
            }
            console.log(`Found ${file}`)

            buildFiles.push(file);
        }
    }
    return buildFiles;
}

async function restoreCache(keys : Array<string>) : Promise<string | undefined> {
    for(var offset = 0; offset < keys.length; offset += MaxCacheKeys) {
        var limit = Math.min(offset + MaxCacheKeys, keys.length);

        var subkeys = keys.slice(offset, limit);

        let firstSubkey = subkeys[0];
        subkeys.shift()

        const cacheKey = await cache.restoreCache(
            CachePaths,
            firstSubkey,
            subkeys
        );

        if(cacheKey) {
            return cacheKey;
        }
    }
    return undefined;
}

/*
Overall plan:

 - search for the relevant build files in the file system
 - if no build files, cache cannot be restored
 - fetch the last n commits of the git history
 - search git history for changes to the build files, get commit hashes
 - if not commit hashes, go by file content hashes
 - search commit history for manual cache resets; filter older commit hashes
 - construct cache keys; two for each hash (success and failure variants)
 - attempt to restore caches, in steps.
 - if hit on the primary (success) key, skip persisting caches. In other words do not prepare/perform a cleanup either.
 - if hit on the secondary (failure) key, persist the cache on successful build
 - otherwise persist the cache.
   - if successful build, clean and persist cache
   - if failed build, just persist cache

*/
async function run(): Promise<void> {
    try {
        const step = core.getInput(Inputs.Step, { required: true });
        core.saveState(State.Step, step);
        if(step === "restore") {
          if (utils.isGhes()) {
              utils.logWarning("Cache action is not supported on GHES");
              utils.setCacheRestoreOutput(Restore.None);
              return;
          }

          // https://github.com/actions/runner/blob/c18c8746db0b7662a13da5596412c05c1ffb07dd/src/Misc/expressionFunc/hashFiles/src/hashFiles.ts

          // Validate inputs, this can cause task failure
          if (!utils.isValidEvent()) {
              utils.logWarning(
                  `Event Validation Error: The event type ${
                      process.env[Events.Key]
                  } is not supported because it's not tied to a branch or tag ref.`
              );
              return;
          }

          var parameterCacheKeyPrefix = "maven"

          let files = await findFiles(BuildFilesSearch);
          if(files.length == 0) {
              utils.logWarning("No build files found for expression " + BuildFilesSearch +", cache cannot be restored");
              return
          }

          const depth = core.getInput(Inputs.Depth, { required: false }) || DefaultGitHistoryDepth;
          const fetchOutput = await runGitCommand(["fetch", "--deepen=" + depth]);

          const githubWorkspace = process.cwd()
          const prefix = `${githubWorkspace}${path.sep}`

          let gitFiles = new Array<string>();
          for (var file of files) {
              gitFiles.push(file.substring(prefix.length));
          }

          const gitFilesHashOutput = await runGitCommand(["log", "--pretty=format:%H", "HEAD", "--"].concat(gitFiles));

          let hashes = gitFilesHashOutput.standardOutAsStringArray()

          let restoreKeys = new Array<string>();

          var goByHash = hashes.length > 0
          if(goByHash) {
              // check commit history for [cache clear] messages,
              // delete all previous hash commits up to and including [cache clear], insert the [cache clear] itself
              // check commit messages for [cache clear] commit messages

              const commitMessages = await runGitCommand(["log", "--format=%H %B"]);
              var commmitHashMessages = commitMessages.standardOutAsStringArray();

              const commitIndex = utils.searchCommitMessages(commmitHashMessages);
              if(commitIndex != -1) {
                  console.log(`Cache cleaned in commit ${commmitHashMessages[commitIndex]}. Ignore all previous caches.`);

                  // determine which commits should be ejected
                  // scan through all later commits from the [clear cache] message
                  // and nuke all hash keys if a match is found
                  for(var k = commitIndex; k < commmitHashMessages.length; k++) {
                      var str = commmitHashMessages[k];
                      var h = str.substr(0, str.indexOf(' '));
                      const index = hashes.indexOf(h);
                      if(index > -1) {
                          hashes = hashes.splice(0, index)
                          break;
                      }
                  }

                  // add the commit with the [clean cache] as a potential cache restore point
                  var str = commmitHashMessages[commitIndex];
                  hashes.push(str.substr(0,str.indexOf(' ')));
              }

              console.log(`Will attempt for restore cache from ${hashes.length} commits`)

              for (var hash of hashes) {
                  restoreKeys.push(`${parameterCacheKeyPrefix}-${hash}-success`)
                  restoreKeys.push(`${parameterCacheKeyPrefix}-${hash}-failure`)
              }
          } else {
              // search all of history for a [clear cache] message
              const commitMessages = await runGitCommand(["log", "--format=%H %B"]);
              var commmitHashMessages = commitMessages.standardOutAsStringArray();

              const commitIndex = utils.searchCommitMessages(commmitHashMessages);
              if(commitIndex != -1) {
                  console.log(`Cache cleaned in commit ${commmitHashMessages[commitIndex]}. Ignore all previous caches.`);

                  restoreKeys.push(`${parameterCacheKeyPrefix}-${commmitHashMessages[commitIndex]}-success`);
                  restoreKeys.push(`${parameterCacheKeyPrefix}-${commmitHashMessages[commitIndex]}-failure`);
              } else {
                  console.log("No git history found for build files, fall back to using file hash instead");

                  const result = crypto.createHash('sha256');
                  for (var file of files) {
                      const hash = crypto.createHash('sha256');
                      const pipeline = util.promisify(stream.pipeline);
                      await pipeline(fs.createReadStream(file), hash);
                      result.write(hash.digest());
                  }
                  result.end();

                  const hashAsString = result.digest('hex');

                  restoreKeys.push(`${parameterCacheKeyPrefix}-${hashAsString}-success`);
                  restoreKeys.push(`${parameterCacheKeyPrefix}-${hashAsString}-failure`);
              }
          }

          let restoreKeySuccess = restoreKeys[0];
          let restoreKeyFailure = restoreKeys[1];

          try {
              var cacheKey = await restoreCache(restoreKeys)

              if (!cacheKey) {
                  console.log("No cache found for current or previous build files. Expect to save a new cache.");
                  utils.setCacheRestoreOutput(Restore.None);

                  utils.ensureMavenDirectoryExists()
                  console.log("If build is successful, save to key " + restoreKeySuccess + ". If build fails, save to " + restoreKeyFailure)
                  fs.writeFileSync(utils.toAbsolutePath(RestoreKeyPath), restoreKeySuccess);
                  core.saveState(State.FailureHash, restoreKeyFailure);

                  // no point in cleaning cache
              } else {
                  const primaryMatch = cacheKey != null && utils.isExactKeyMatch(restoreKeySuccess, cacheKey);
                  if(primaryMatch) {
                      core.info(`Cache is up to date.`);
                      utils.setCacheRestoreOutput(Restore.Full);
                  } else {
                      const secondaryMatch = cacheKey != null && utils.isExactKeyMatch(restoreKeyFailure, cacheKey);
                      if(secondaryMatch) {
                          core.info(`Cache was left over after a failed build, expect to clean and save a new cache if build is successful.`);
                          utils.ensureMavenDirectoryExists()

                          console.log("If build is successful, save to key " + restoreKeySuccess + ". If build fails, save to " + restoreKeyFailure)
                          fs.writeFileSync(utils.toAbsolutePath(RestoreKeyPath), restoreKeySuccess);

                          // i.e. do not save another cache if the build fails again
                      } else {
                          core.info(`Cache is outdated, expect to save a new cache.`);
                          utils.ensureMavenDirectoryExists()
                          fs.writeFileSync(utils.toAbsolutePath(RestoreKeyPath), restoreKeySuccess);

                          core.saveState(State.FailureHash, restoreKeyFailure);
                      }
                      utils.setCacheRestoreOutput(Restore.Partial);

                      maven.prepareCleanup();
                  }
              }
          } catch (error) {
              if (error.name === cache.ValidationError.name) {
                  throw error;
              } else {
                  utils.logWarning(error.message);
                  utils.setCacheRestoreOutput(Restore.None);
              }
          }
        } else if(step === "save") {
          try {
              const absolutePath = utils.toAbsolutePath(RestoreKeyPath)
              if (fs.existsSync(absolutePath)) {
                console.log("Save cache for successful build..");

                //file exists
                const successKey = fs.readFileSync(absolutePath, {encoding:'utf8', flag:'r'});

                maven.performCleanup(CachePaths);

                try {
                    await cache.saveCache(CachePaths, successKey, {
                        uploadChunkSize: utils.getInputAsInt(Inputs.UploadChunkSize)
                    });
                } catch (error) {
                    if (error.name === cache.ValidationError.name) {
                        throw error;
                    } else if (error.name === cache.ReserveCacheError.name) {
                        core.info(error.message);
                    } else {
                        utils.logWarning(error.message);
                    }
                }
              } else {
                  console.error("Skip saving cache for successful build; cache is already up to date.")
              }
          } catch(err) {
              console.error(err)
          }
        } else {
            core.setFailed("Step must be 'restore' or 'save'");
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();

export default run;
