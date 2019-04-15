const args = require('./lib/parse_args')(process);
const processOrg = require('./lib/process_org');
const mkTmpDir = require('./lib/mk_tmp_dir');

/* eslint-disable no-console */
function dump(...msg) {
  console.log(...msg);
}
function debug(...msg) {
  console.log('[ghoot:debug]', ...msg);
}
function error(...msg) {
  console.error('[ghoot:error]', ...msg);
}
/* eslint-enable no-console */

const run = async () => {
  processOrg({
    tempDir: await mkTmpDir(),
    ...args,
    debug,
    error,
  })
    .then(dump)
    .catch(error);
};

run();
