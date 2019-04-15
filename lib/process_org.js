const {
  defaults,
  each,
  map,
  reduce,
  slice,
} = require('lodash');
const path = require('path');
const util = require('util');
const countLinesInFile = util.promisify(require('count-lines-in-file'));
const detect = util.promisify(require('language-detect'));
const exec = util.promisify(require('child_process').exec);
const glob = util.promisify(require('glob'));

const Octokit = require('@octokit/rest');

const sequencePromises = async (collection, promisify) => {
  const [first, ...rest] = collection;
  if (!first) { return []; }
  return [
    await promisify(first),
    ...await sequencePromises(rest, promisify),
  ];
};

const years = [2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019];
const dates = map(years, year => `${year}-01-01`);

module.exports = async (args) => {
  const {
    org,
    token,
    tempDir,
    debug,
  } = args;

  const octokit = new Octokit({ auth: `token ${token}` });

  const listForOrg = () => octokit.paginate(
    octokit.repos.listForOrg.endpoint.merge({ org, type: 'sources' })
  );
  const repos = await listForOrg();

  const cloneRepo = async (repo) => {
    debug(`git clone ${repo.clone_url}`);
    return exec(`git clone https://quaelin:${token}@github.com/${repo.full_name}.git`, {
      cwd: tempDir,
    });
  };

  const repoDir = repo => `${tempDir}/${repo.name}`;

  const getCommitAtDate = async (repo, date) => (
    exec(`git log -1 --before=${date}`, { cwd: repoDir(repo) })
      .then(({ stdout }) => stdout.match(/^commit ([a-z0-9]*)/)[1])
  );

  const checkoutDate = async (repo, date) => {
    debug(`Checking out ${repo.name} as of ${date}`);
    const commit = await getCommitAtDate(repo, date);
    debug(`git checkout ${commit}`);
    return exec(`git checkout ${commit}`, {
      cwd: repoDir(repo),
    });
  };

  const enumerateFiles = async repo => glob('**/*.*', { cwd: repoDir(repo), nodir: true });

  const readLineData = async repo => Promise.all(map(
    await enumerateFiles(repo),
    async (file) => {
      const fullPath = path.resolve(repoDir(repo), file);
      return {
        file,
        lines: await countLinesInFile(fullPath).catch(() => 0),
        language: await detect(fullPath).catch(() => null),
      };
    }
  ));

  const analyzeRepo = async (repo) => {
    debug('Analyzing');
    const lineData = await readLineData(repo);
    const totalLines = reduce(
      lineData,
      (totalSoFar, { lines }) => totalSoFar + lines,
      0
    );
    const linesByLanguage = reduce(
      lineData,
      (languages, { lines, language }) => {
        if (language) {
          /* eslint-disable no-param-reassign */
          languages[language] = languages[language] || 0;
          languages[language] += lines;
          /* eslint-enable no-param-reassign */
        }
        return languages;
      },
      {}
    );
    return { totalLines, linesByLanguage };
  };

  debug(`Performing clone of repos into ${tempDir}`);
  const statsByRepo = await sequencePromises(repos, async (repo) => {
    await cloneRepo(repo);
    return {
      repoName: repo.full_name,
      snapshots: await sequencePromises(dates, async date => ({
        date,
        stats: await checkoutDate(repo, date)
          .then(() => analyzeRepo(repo))
          .catch(() => null),
      })),
    };
  });

  debug('Reorganize stats');
  const statsByDate = {};
  each(statsByRepo, ({ snapshots }) => {
    each(snapshots, ({ date, stats }) => {
      if (stats) {
        statsByDate[date] = defaults(statsByDate[date], {
          numRepos: 0,
          totalLines: 0,
          linesByLanguage: {},
        });
        const thisDay = statsByDate[date];
        thisDay.numRepos += 1;
        thisDay.totalLines += stats.totalLines;
        each(stats.linesByLanguage, (lines, language) => {
          thisDay.linesByLanguage[language] = thisDay.linesByLanguage[language] || 0;
          thisDay.linesByLanguage[language] += lines;
        });
      }
    });
  });
  return statsByDate;
};
