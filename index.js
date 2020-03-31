#!/usr/bin/env node

/**
 * --api-key valid api key for project with correct permissions
 * --org org the project belongs to
 * --project project to check
 * --days integer days since last active
 * --dry-run flag to include for a list of streams that will be deleted with no data in last days
 */
const yargs = require("yargs");
const moment = require("moment");
const request = require("request-promise");
const Promise = require("bluebird");
const fs = require("promise-fs");

yargs.command(
  "delete-streams <org> <project>",
  "Command for listing and deleting streams in a project that have not been active in the last x days.",
  yargs => {
    yargs.positional("org", {
      describe: "Lightstep organization"
    }),
      yargs.positional("project", {
        describe: "Lightstep project"
      }),
      yargs.options({
        service: {
          alias: "f",
          demandOption: false,
          default: "",
          describe:
            "Service string to use as a filter in the query of the stream. For example, if I only wanted to look at streams for service 'my-service' I would set this to 'my-service'",
          type: "string"
        },
        "api-env": {
          alias: "e",
          demandOption: false,
          default: "",
          describe: "Set environment suffix of API to hit.",
          type: "string"
        },
        days: {
          alias: "d",
          demandOption: false,
          default: 30,
          describe: "Integer days since last active data",
          type: "number"
        },
        "dry-run": {
          alias: "r",
          demandOption: false,
          default: true,
          describe: "List non-active streams without deleting",
          type: "boolean"
        },
        "api-key": {
          alias: "a",
          demandOption: true,
          describe:
            "Valid API Key for project with correct permissions for stream list and deletion",
          type: "string"
        },
        resume: {
          alias: "s",
          demandOption: false,
          default: false,
          describe:
            'Resumes the command from a "streams-status.json" file assuming an error occurred (i.e. rate-limiting).',
          type: "boolean"
        }
      });
  },
  argv => {
    console.info(
      ` Running for org: ${argv.org}, project: ${argv.project} with dry-run set to: ${argv.dryRun}, days since seen data set to: ${argv.days}, resume from file set to: ${argv.resume}`
    );

    let youngest = moment();
    let oldest = moment().subtract(argv.days, "days");

    if (argv.apiEnv) {
      // for lightstep specific environments (using apiEnv) add a dash
      // since yargs doesn't deal with dashes well
      argv.apiEnv = `-${argv.apiEnv}`;
    }

    if (argv.resume) {
      return resume(argv, youngest, oldest);
    } else {
      return start(argv, youngest, oldest);
    }
  }
).argv;

// flow: streams that are active are filtered out in batches
// those that are known inactive get marked in stream status map
// those that are unknown also get marked as unknown in stream status map
// (in the case that the flow is interrupted by an api error (i.e. 429))
// the stream status map can be reloaded and the job can resume (use resume flag)
function batchCheckStreamStatuses(argv, youngest, oldest, ids, statuses) {
  let batches = split(ids);
  return Promise.map(
    batches,
    b => {
      return filterBatch(argv, youngest, oldest, b, statuses);
    },
    { concurrency: 8 }
  ).then(() => {
    return statuses;
  });
}

function batchDeleteStreams(argv, ids, statuses) {
  let batches = split(ids);
  return Promise.map(
    batches,
    (b, i) => {
      return deleteBatch(argv, b, statuses);
    },
    { concurrency: 8 }
  ).then(() => {
    return statuses;
  });
}

function start(argv, youngest, oldest) {
  return listStreamsRequest(argv, youngest, oldest) // list streams
    .then(ids => batchCheckStreamStatuses(argv, youngest, oldest, ids, {})) // check all statuses of streams from list streams request
    .then(statuses => storeStreamStatus(statuses)) // save our progress to file (regardless of whether it error'd out or not on the previous step for some batches)
    .then(statuses => deleteStreams(argv, statuses)) // try and delete the streams that were marked inactive
    .then(statuses => storeStreamStatus(statuses)) // save our progress to file again (regardless of whether it error'd out or not on the previous step for some batches)
    .then(report)
    .catch(err => {
      console.error(err);
    });
}

function resume(argv, youngest, oldest) {
  return getStreamStatus() // load file (get list of streams with current status (unknown, inactive or deleted))
    .then(streamStatuses => {
      // check any statuses of streams that are marked unknown
      let streamIdsToBeChecked = Object.keys(streamStatuses).filter(id => {
        return streamStatuses[id] === "unknown";
      });
      return batchCheckStreamStatuses(
        argv,
        youngest,
        oldest,
        streamIdsToBeChecked,
        streamStatuses
      );
    })
    .then(statuses => storeStreamStatus(statuses)) // save our progress to file (regardless of whether it error'd out or not on the previous step for some batches)
    .then(statuses => deleteStreams(argv, statuses)) // try and delete the streams that were marked inactive
    .then(statuses => storeStreamStatus(statuses)) // save our progress to file again (regardless of whether it error'd out or not on the previous step for some batches)
    .then(report)
    .catch(err => {
      console.error(err);
    });
}

function report(statuses) {
  let deleted = [];
  let inactive = [];
  let unknown = [];
  Object.keys(statuses).forEach(streamId => {
    switch (statuses[streamId]) {
      case "unknown":
        unknown.push(streamId);
        break;
      case "inactive":
        inactive.push(streamId);
        break;
      case "deleted":
        deleted.push(streamId);
    }
  });

  console.info(
    `\n======\n The following streams are of unknown status: \n ${JSON.stringify(
      unknown
    )} \n\n The following streams are of inactive status and need to be deleted: \n ${JSON.stringify(
      inactive
    )} \n\n The following streams are deleted: \n ${JSON.stringify(deleted)}\n`
  );
}

function deleteStreams(argv, streamStatuses) {
  if (argv.dryRun) {
    console.info(
      `\n In dry-run mode, no streams were deleted. Run without --dry-run flag and with --resume flag to delete streams from this run. Stream statuses stored in "streams-status.json".`
    );
    return Promise.resolve(streamStatuses);
  }

  let streamIdsToBeDeleted = Object.keys(streamStatuses).filter(id => {
    return streamStatuses[id] === "inactive";
  });

  return batchDeleteStreams(argv, streamIdsToBeDeleted, streamStatuses);
}

function formatError(err) {
  let ret = {};
  if (err.message) {
    ret.message = err.message;
  }
  if (err.statusCode) {
    ret.statusCode = err.statusCode;
  }
  if (!ret.message && !ret.statusCode) {
    ret.err = err;
  }
  if (err.options && err.options.uri) {
    ret.uri = err.options.uri;
  }
  return ret;
}

function storeStreamStatus(status) {
  return fs
    .writeFile("./streams-status.json", JSON.stringify(status))
    .then(() => {
      return status;
    });
}

function getStreamStatus() {
  return fs.readFile("./streams-status.json").then(JSON.parse);
}

// process
const BATCH_SIZE = 10;
function split(all, curr, res) {
  if (curr == null) {
    curr = 0;
  }
  if (res == null) {
    res = [];
  }
  if (curr + BATCH_SIZE > all.length && res.length == 0) return [all]; // batch size was bigger than the number of streams to start with
  if (curr + BATCH_SIZE > all.length) return res;
  res.push(all.slice(curr, curr + BATCH_SIZE));
  curr = curr + BATCH_SIZE;

  return split(all, curr, res);
}

// filter to only streams that are not active:
// for each stream in the batch of BATCH_SIZE, make a request with 1 hr resolution,
// check ops counts for last n days, if no ops > 0 in last n days stream is not active
// after this is complete for the batch, filter the batch to only the non-active streams.
function filterBatch(args, youngest, oldest, batch, statuses) {
  let reqs = [];
  batch.forEach(streamId => {
    reqs.push(timeseriesRequest(args, streamId, youngest, oldest));
  });

  return Promise.all(reqs)
    .then(res => {
      let filtered = res.filter(s => !s.active);
      filtered.forEach(r => {
        statuses[r.id] = "inactive";
      });
      // handle unknowns as well so we don't keep checking them in a --resume situation
      let active = res.filter(s => s.active);
      active.forEach(r => {
        delete statuses[r.id];
      });
      return statuses;
    })
    .catch(err => {
      // assume we don't know if the streams are inactive or not if some error happens
      // (easier than figuring out individual logic but might be unneccessary)
      console.error(
        `\n Error occurred while checking stream activity for batch, error: ${JSON.stringify(
          formatError(err)
        )}. Setting status to unknown on this batch.`
      );
      batch.forEach(streamId => {
        statuses[streamId] = "unknown";
      });
      return Promise.resolve();
    });
}

function deleteBatch(args, batch, statuses) {
  let deletions = [];
  batch.forEach(streamId => {
    deletions.push(
      deleteStreamRequest(args, streamId).then(() => {
        statuses[streamId] = "deleted";
      })
    );
  });

  return Promise.all(deletions).catch(err => {
    // Note deleting a stream that's already deleted returns a 500 instead of 404 :/
    console.error(
      `\n Error occurred while deleting streams for batch, error: ${JSON.stringify(
        formatError(err)
      )}. Some streams may not be deleted.`
    );
    return Promise.resolve();
  });
}

function deleteStreamRequest(args, streamId) {
  const opts = {
    headers: {
      authorization: args.apiKey
    },
    json: true
  };

  return request.delete(
    `https://api${args.apiEnv}.lightstep.com/public/v0.1/${args.org}/projects/${args.project}/searches/${streamId}`,
    opts
  );
}

/* exclude looking at certain streams */
function excludeStream(s, youngest, oldest) {
  let created = moment(s.attributes["created-time"]);
  let recentlyCreated = created.isBetween(oldest, youngest); // don't look at/delete streams that are recently created (within our window)
  let excludeStrings = ["load", "Load", "Load-test", "load-test"]; // don't look at/delete streams with these strings in their query or name
  let protected = excludeStrings.some(str => {
    return s.attributes.name.includes(str) || s.attributes.query.includes(str);
  });
  return protected || recentlyCreated;
}

function isInService(s, service) {
  if (service === "") {
    return true;
  }
  return s.attributes.query.includes(service);
}

function listStreamsRequest(args, youngest, oldest) {
  const opts = {
    headers: {
      authorization: args.apiKey
    },
    json: true
  };

  return request
    .get(
      `https://api${args.apiEnv}.lightstep.com/public/v0.1/${args.org}/projects/${args.project}/searches`,
      opts
    )
    .then(res => {
      return res.data
        .filter(r => !excludeStream(r, youngest, oldest))
        .filter(r => isInService(r, args.service))
        .map(s => s.id);
    });
}

function timeseriesRequest(args, streamId, youngest, oldest) {
  const opts = {
    headers: {
      authorization: args.apiKey
    },
    json: true
  };

  return request
    .get(
      `https://api${args.apiEnv}.lightstep.com/public/v0.1/${
        args.org
      }/projects/${
        args.project
      }/searches/${streamId}/timeseries?include-ops-counts=1&include-error-counts=0&youngest-time=${youngest.toISOString()}&oldest-time=${oldest.toISOString()}&resolution-ms=36000000`,
      opts
    )
    .then(res => {
      let ret = {
        active: res.data.attributes["ops-counts"].some(p => p > 0),
        id: streamId
      };
      return ret;
    });
}
