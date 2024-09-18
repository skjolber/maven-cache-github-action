# Maven Cache Github Action
This [Github Action](https://docs.github.com/en/actions) adds improved support for __caching Maven dependencies between builds__ compared to Github's built-in Maven cache. 

Features:
  * restores dependency cache with the help of the git history
  * clears unused dependencies before saving caches
  * caches the Maven wrapper if present
  * relies on Github Action's built-in cache infrastructure (just like Github's [Cache Action](https://github.com/actions/cache))

Benefits:
  * faster and more predictable builds times
  * considerable load reduction on artifact repositories

Audience:
  * primarily intended for use with (private) third party repositories, i.e. 'one repo to rule them all'
    * repos which act as artifact caches for other remote repositories and/or
    * repos with limited transfer capacity, and/or
    * repos where data transfer is limited or [increases cost](https://jfrog.com/pricing/)
  * also works well with Maven Central 

Note that Github seems to have an excellent network connection to Maven Central, so reducing the reliance of the (private) third party repositories by lettings projects additionally (i.e. first) connect directly to Maven Central might be a good alternative.

## Usage
The `skjolber/maven-cache-github-action` action must be present __twice__ in your build job, with `step: restore` and `step: save` parameters:

```yaml
jobs:
  hello_world_job:
    runs-on: ubuntu-latest
    name: Maven build with caching
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Set up JDK 21
        uses: actions/setup-java@v4
        with:
          java-version: 21
          distribution: liberica
      - name: Restore Maven cache
        uses: skjolber/maven-cache-github-action@v3.1
        with:
          step: restore
      - name: Build hello-world application with Maven
        run: mvn --batch-mode --update-snapshots verify
      - name: Save Maven cache
        uses: skjolber/maven-cache-github-action@v3.1
        with:
          step: save
```

The second steps saves your cache even if the dependencies were only partially resolved:

 * artifact transfers fails
 * partial build

### Inputs

Required:

* `step` - Build step, i.e. `restore` or `save`

Optional:

* `key-path`: A list of files and wildcard patterns used to detect files which affects dependency cache content (default: **/pom.xml)
* `cache-key-prefix`: Prefix for cache keys (default: maven-cache-github-action)
* `wrapper`: Enable Maven wrapper cache (default: true, but skipped if `.mvn/wrapper/maven-wrapper.properties` is not present)
* `depth` - Maximum git history depth to search for changes to build files (default: 100 commits).
* `upload-chunk-size` - The chunk size used to split up large files during upload, in bytes.
* `enableCrossOsArchive` - An optional boolean when enabled, allows windows runners to save or restore caches that can be restored or saved respectively on other platforms (defaults: false).

### Outputs

* `cache-restore` - A value to indicate result of cache restore:
	* `none`  - no cache was restored
	* `partial` - a cache was restored, but from a previous version of the build files (or a failed build for the current).
	* `full` - cache was restored and is up to date.

### Cache scopes
Combine `cache-key-prefix` with `key-path` to have seperate caches within the same repo.

### Flushing the depenency cache
While unused dependencies are contiously removed from the (incremental) cache, it is sometimes necessary to clean the cache completely.

Add `[cache clear]` to a commit-message build with a new, empty cache entry.

## Privacy
This action only saves/loads dependency data to/from the Github Action cache infrastructure. 

On initial setup, it additionally transfers a [cache cleaning utility](https://github.com/skjolber/maven-pom-recorder) from Maven Central using an HTTP call.

## License
The scripts and documentation in this project are released under the [MIT License](LICENSE)

## See Also
 * [Tidy Cache](https://github.com/marketplace/actions/tidy-cache) - clear cache (for successful builds only)
 * Entur [CircleCI Maven Orb](https://github.com/entur/maven-orb)
 * Github [Cache Action](https://github.com/actions/cache)
