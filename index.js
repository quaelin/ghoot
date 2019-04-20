const parseArgs = require('./lib/parse_args');
const processOrg = require('./lib/process_org');
const mkTmpDir = require('./lib/mk_tmp_dir');

const usage = 'Usage: ghoot <org> --name=<user> --token=<github_token> [--tmp=<tmpdir>]';
let args;

/* eslint-disable no-console */
function dump(...msg) {
  console.log(...msg);
}
function debug(...msg) {
  if (args.debug) {
    console.log('[ghoot:debug]', ...msg);
  }
}
function error(...msg) {
  console.error('[ghoot:error]', ...msg);
}
/* eslint-enable no-console */

const run = async () => {
  args = await parseArgs(process).catch(() => {
    dump(usage);
    process.exit(1);
  });

  processOrg({
    dir: args.dir || await mkTmpDir(args.tmp),
    ...args,
    dump,
    debug,
    error,
  }).catch(error);
};

run();
