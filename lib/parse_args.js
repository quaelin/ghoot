const minimist = require('minimist');

module.exports = ({ argv }) => {
  const args = minimist(argv.slice(2));

  // console.log({ args });
  return args;
};
