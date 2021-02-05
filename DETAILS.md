


# Caching strategy overview
Maven transfers artifacts as it builds, and a failed build will result in only part of the necessary artifacts being transferred. 
Likevise, restored caches from outdated builds will only contain parts of the necessary artifacts, in addition to artifacts no longer part of the build.

So lets model the cache state as follows:

 * Empty
 * Partially full
	 * from failed build
	 * from previous build
 * Full
	 * From succesful build

Note that for incremental caching to work, artifacts no longer in use must be purged from the cache. Otherwise duration overhead for save and restore operations would eat up any time saved when constructing the cache entry.

## Workflow
From the cache's viewpoint, the workflow is as follows

 * __Restore__: Transfer previously cached artifacts from storage
 * __Pre-process__: Transfer additional artifacts required for build from an external source (Maven)
 * __Post-process__: Preparing cache (i.e. cleanup up outdated artifacts)
 * __Save__: Transfer cached artifacts to storage



## Caching using a hash of build files
This seems to be the default behaviour for CI servers using immutable caches.

Advantages:

 * Simple
 * Low chance of corrupt cache
 * Cache 

Disadvantages:

 * No caching on build file changes (with the exception of reverted builds)
 * 

Its main advantage over the [Github Cache Action](https://github.com/actions/cache) is that it is able to restore the cache also when the build files (i.e. pom files) are modified. It trivially does so by looking for build file changes in Git history.

Advantages:

 * faster and more predictable builds times 
 * considerably less load on your artifact store
 * plug and play: no external service or state necessary

So this action is especially well suited for projects with frequent updates to build files, for example due to enabling  automatic tools like [Renovate](https://github.com/renovatebot/renovate) or [Snyk](https://snyk.io/).

## Usage
The `skjolber/maven-cache-github-action` action must be present __twice__ in your build job, with `step: restore` and `step: save` parameters:

```yaml
jobs:
  hello_world_job:
    runs-on: ubuntu-latest
    name: Maven build with caching
    steps:
      - name: Checkout
        uses: actions/checkout@v2
      - name: Set up JDK 1.8
        uses: actions/setup-java@v1
        with:
          java-version: 1.8
      - name: Restore Maven cache
        uses: skjolber/maven-cache-github-action@1
        with:
          step: restore
      - name: Build hello-world application with Maven
        run: mvn --batch-mode --update-snapshots verify
      - name: Save Maven cache
        uses: skjolber/maven-cache-github-action@1
        with:
          step: save
```

### Inputs

* `step` - Build step, i.e. `restore` or `save` (required).
* `depth` - Maximum git history depth to search for changes to build files. Default to 100 commits (optional).
* `upload-chunk-size` - The chunk size used to split up large files during upload, in bytes (optional).

### Outputs

* `cache-restore` - A value to indicate result of cache restore: 
	* `none`  - no cache was restored
	* `partial` - a cache was restored, but from a previous version of the build files (or a failed build for the current). 
	* `full` - cache was restored and is up to date.

### Cache scopes
The cache is scoped to the branch. The default branch cache is available to other branches.

In other words, projects using the `develop` branch will have a performance benefit to making it the default.

### Flushing the cache
While unused dependencies are contiously removed from the (incremental) cache, it is sometimes necessary to clean the cache completely.

Add `[cache clear]` to a commit-message build with a new, empty cache entry.

## License
The scripts and documentation in this project are released under the [MIT License](LICENSE)

## See Also
 * Entur [CircleCI Maven Orb](https://github.com/entur/maven-orb)
 * Github [Cache Action](https://github.com/actions/cache)

