const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');

const mkTmpDir = util.promisify(fs.mkdtemp);

module.exports = (dir = path.join(os.tmpdir(), 'ghoot-')) => mkTmpDir(dir);
