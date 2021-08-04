# Maven Cache Github Action
This [Github Action](https://docs.github.com/en/actions) adds support for __caching Maven dependencies between builds__.

This action restores previous caches with the help of the git history, and continously clears unused dependencies, for faster and more predictable builds times.

It is __especially well suited for project under constant development (updated more than once a week)__, which over time will accumulate a lot of outdated dependencies from previous builds. 

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
        uses: skjolber/maven-cache-github-action@v1
        with:
          step: restore
      - name: Build hello-world application with Maven
        run: mvn --batch-mode --update-snapshots verify
      - name: Save Maven cache
        uses: skjolber/maven-cache-github-action@v1
        with:
          step: save
```

The second steps saves your cache even if the dependencies were only partially resolved. 

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
