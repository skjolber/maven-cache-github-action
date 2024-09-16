import * as cache from "@actions/cache";
import * as core from "@actions/core";

import { CachePaths, Inputs, State } from "./constants";
import * as utils from "./utils/actionUtils";
import * as maven from "./utils/maven";

async function run(): Promise<void> {
    // so job failed
    // however was the cache already saved
    const step = core.getState(State.Step);

    if (step === "restore") {
        const hash = core.getState(State.FailureHash);

        if (hash.length > 0) {
            console.log("Save cache for failed build..");

            // nuke resolution attempts, so that resolution is always reattempted on next build

            const enableCrossOsArchive = utils.getInputAsBool(
                Inputs.EnableCrossOsArchive
            );

            await maven.removeResolutionAttempts(CachePaths);

            try {
                await cache.saveCache(
                    CachePaths,
                    hash,
                    {
                        uploadChunkSize: utils.getInputAsInt(
                            Inputs.UploadChunkSize
                        )
                    },
                    enableCrossOsArchive
                );
                console.log(
                    "Cache saved for failed build. Another cache will be saved once the build is successful."
                );

                const cacheId = await cache.saveCache(
                    CachePaths,
                    hash,
                    {
                        uploadChunkSize: utils.getInputAsInt(
                            Inputs.UploadChunkSize
                        )
                    },
                    enableCrossOsArchive
                );

                if (cacheId != -1) {
                    core.info(`Cache saved with key: ${hash}`);
                }
            } catch (err: unknown) {
                const error = err as Error;
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
