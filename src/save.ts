import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from 'path'
import * as maven from "./utils/maven";

import { Events, Inputs, State, CachePaths } from "./constants";
import * as utils from "./utils/actionUtils";

async function run(): Promise<void> {

  // so job failed
  // however was the cache already saved
  const step = core.getState(State.Step);

  if(step === "restore") {
    const hash = core.getState(State.FailureHash);

    if(hash.length > 0) {
        console.log("Save cache for failed build..");

        // nuke resolution attempts, so that resolution is always reattempted on next build

        await maven.removeResolutionAttempts(CachePaths);

        try {
            await cache.saveCache(CachePaths, hash, {
                uploadChunkSize: utils.getInputAsInt(Inputs.UploadChunkSize)
            });
            console.log("Cache saved for failed build. Another cache will be saved once the build is successful.")
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
          console.log("Do not save cache for failed build");
      }
  }

}

run();

export default run;
