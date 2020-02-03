#!/usr/bin/env node

/**
 * --api-key valid api key for project with correct permissions
 * --org org the project belongs to
 * --project project to check
 * --days integer days since last active
 * --dry-run flag to include for a list of streams that will be deleted with no data in last days
 */
const yargs = require("yargs");

yargs
  .command(
    "delete-streams <org> <project>",
    "Command for listing and deleting streams in a project that have not been active in the last x days.",
    yargs => {
      yargs.positional("org", {
        describe: "Lightstep organization",
      }),
      yargs.positional("project", {
        describe: "Lightstep project",
      }),
      yargs.options({
        'days': {
          alias: 'd',
          demandOption: false,
          default: 30,
          describe: 'Integer days since last active data',
          type: 'number'
        },
        'dry-run': {
          alias: 'r',
          demandOption: false,
          default: true,
          describe: 'List non-active streams without deleting',
          type: 'boolean'
        },
        'api-key': {
          alias: 'a',
          demandOption: true,
          describe: 'Valid API Key for project with correct permissions for stream list and deletion',
          type: 'string'
        },
      })
    },
    argv => {
      console.info(argv.org);
      console.info(argv.project);
      console.info(argv.apiKey);
      console.info(argv.dryRun);
      console.info(argv.days);
      // if (argv.verbose) console.info(`start server on :${argv.port}`);
      // serve(argv.port);
    }
  ).argv;


