const minimist = require('minimist');

module.exports = async ({ argv }) => {
  const args = minimist(argv.slice(2));
  [args.org] = args._;

  if (!args.org) {
    throw new Error('No org specified');
  }
  if (!args.token) {
    throw new Error('No token specified');
  }
  if (!args.user) {
    throw new Error('No user specified');
  }
  // console.log({ args });
  return args;
};
