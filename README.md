# lightstep-stream-deletion-script
Uses Lightstep public APIs to check and delete streams. * Alpha * 

## Instructions
Run `npm install` to install the required libraries.

The script runs by default in --dry-run mode. This means that it won't actually delete the streams, it'll just check them all and let you know which ones don't have data. It does this in batches with a parallelism factor of 8. In the case that you get rate-limited, it'll save progress in a file called streams-status.json. Resume where you left off with the --resume flag. It excludes streams that are recently created.

## Examples
Run `node index.js --help` for full usage after running install.

### Short example of basic command:
`node index.js delete-streams <org> <project> --api-key <api-key> --dry-run <true or false, default true> --days <days since active data default 30>`

### Example running with dry-run first (recommended):
Run: ```node index.js delete-streams LightStep stephanie-test --api-key <api-key> --dry-run true```

Look at `streams-status.json` for the stream ids (also visible in the ui by going to `app.lightstep.com/<project>/streams/<id>`). Warn people their streams are going to be deleted (optional). 

Finall to delete the streams run: ```node index.js delete-streams LightStep stephanie-test --api-key <api-key> --dry-run false```

### Example running with resume:
Run: ```node index.js delete-streams LightStep stephanie-test --api-key <api-key> --dry-run true```

Then let's say it got rate limited somewhere (will console log an error). Take a look at the `streams-status.json` to see which stream ids are considered unknown. If you want you can even set the statuses to override them at this point (for example if you manually deleted some, change the status to "deleted" or if you know they are inactive, change status to "inactive"). Valid values for status are "inactive", "deleted", and "unknown".

You can then run: 
```node index.js delete-streams LightStep stephanie-test --api-key <api-key> --dry-run true --resume```
to complete checking for inactive streams. At this point only inactive streams will be in your streams-status.json.

Finally run:
```node index.js delete-streams LightStep stephanie-test --api-key <api-key> --dry-run false --resume```
To delete the streams after you've checked them out/checked with people who own them, etc.

### Additional options:
To filter for streams with only a particular service (or other string in their query) run with the `--service <your string/service>` flag.