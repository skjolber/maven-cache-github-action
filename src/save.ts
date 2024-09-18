import * as cache from "@actions/cache";
import * as core from "@actions/core";

import { State } from "./constants";
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

            const cachePaths = utils.getCachePaths();

            await maven.removeResolutionAttempts(cachePaths);

            const enableCrossOsArchive =
                core.getState(State.EnableCrossOsArchive) == "true";

            const uploadChunkSizeString = core.getState(State.UploadChunkSize);
            const uploadChunkSize = parseInt(uploadChunkSizeString);

            try {
                const cacheId = await cache.saveCache(
                    cachePaths,
                    hash,
                    {
                        uploadChunkSize:
                            uploadChunkSize == -1 ? undefined : uploadChunkSize
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

        try {
            await maven.saveWrapperCache();
        } catch (err: unknown) {
            console.log("Problem saving wrapper cache", err);
        }
    }
}

run();

export default run;
