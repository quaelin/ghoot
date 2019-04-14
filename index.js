const Octokit = require('@octokit/rest');
const args = require('./lib/parse_args')(process);

const octokit = new Octokit();

const showOrg = async (org) => {
  const data = await octokit.repos.listForOrg({ org });
  console.log(data); // eslint-disable-line no-console
};

showOrg(args._[0]);
