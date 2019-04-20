const { keys, range } = require('lodash');
const path = require('path');
const util = require('util');
const countLinesInFile = util.promisify(require('count-lines-in-file'));
const detect = util.promisify(require('language-detect'));
const exec = util.promisify(require('child_process').exec);
const glob = util.promisify(require('glob'));
const { isBinaryFile } = require('isbinaryfile');
const lstat = util.promisify(require('fs').lstat);
const Octokit = require('@octokit/rest');
const rxjs = require('rxjs');
const {
  concatMap,
  filter,
  map,
  mergeMap,
  reduce,
} = require('rxjs/operators');

module.exports = async (args) => {
  const {
    debug,
    dump,
    org,
    dir,
    token,
    user,
  } = args;

  const octokit = new Octokit({ auth: `token ${token}` });

  const listForOrg = () => octokit.paginate(
    octokit.repos.listForOrg.endpoint.merge({ org, type: 'sources' })
  );
  const repos = await listForOrg();

  const cloneRepo = async (repo) => {
    debug(`git clone ${repo.clone_url}`);
    return exec(`git clone https://${user}:${token}@github.com/${repo.full_name}.git`, {
      cwd: dir,
    });
  };

  const repoDir = repo => `${dir}/${repo.name}`;

  const getCommitAtDate = async (repo, date) => (
    exec(`git log -1 --before=${date}`, { cwd: repoDir(repo) })
      .then(({ stdout }) => stdout.match(/^commit ([a-z0-9]*)/)[1])
  );

  const gitClean = async repo => exec('git clean -fxd', { cwd: repoDir(repo) });

  const checkoutDate = async (repo, date) => {
    debug(`Looking for ${repo.name} as of ${date}`);
    const commit = await getCommitAtDate(repo, date);
    await gitClean(repo);
    debug(`(${repo.name}) git checkout ${commit}`);
    return exec(`git checkout ${commit}`, {
      cwd: repoDir(repo),
    });
  };

  const enumerateFiles = async repo => glob('**/*.*', {
    cwd: repoDir(repo),
    follow: false,
    nodir: true,
  });

  const repoAnalysisPipeline = (repo, date) => rxjs.from([{ repo, date }]).pipe(
    // Checkout repo at specific date
    concatMap(() => checkoutDate(repo, date).then(() => true).catch(() => false)),
    filter(success => success),

    // Enumerate all the files at that date
    mergeMap(() => enumerateFiles(repo)),
    mergeMap(files => rxjs.from(files)),

    // Stat each file to see if it's a file/directory/symlink etc.  Only keep real files.
    map(file => ({ relPath: file, fullPath: path.resolve(repoDir(repo), file) })),
    concatMap(file => lstat(file.fullPath).then(stats => ({ ...file, isFile: stats.isFile() }))),
    filter(file => file.isFile),

    // Do line count and language detection on each real file.
    mergeMap(async (file) => {
      const isBinary = await isBinaryFile(file.fullPath);
      return {
        ...file,
        lines: isBinary ? null : await countLinesInFile(file.fullPath).catch(() => 0),
        language: isBinary ? null : await detect(file.fullPath).catch(() => null),
      };
    }),

    // Filter out any files where we failed to detect a language
    filter(({ language }) => !!language),

    // Roll up the stats
    reduce((stats, { relPath, lines, language }) => {
      /* eslint-disable no-param-reassign */
      stats.langs[language] = stats.langs[language] || { files: 0, lines: 0 };
      stats.langs[language].files += 1;
      stats.langs[language].lines += lines;
      /* eslint-enable no-param-reassign */
      return stats;
    }, { langs: {} }),

    map(stats => ({ repo, date, stats }))
  );

  debug(`Performing clone of repos into ${dir}`);
  dump('repo,date,language,files,lines');
  await rxjs.from(repos).pipe(
    // Clone repo, or checkout master if it already exists
    concatMap(async (repo) => {
      await cloneRepo(repo).catch(() => exec('git checkout master', {
        cwd: repoDir(repo),
      }));
      return repo;
    }),

    // Count down years from current year to 2008 (first full year of Github history)
    mergeMap(repo => rxjs.from(range(new Date().getFullYear(), 2008, -1)).pipe(
      map(year => ({ repo, date: `${year}-01-01` }))
    )),

    concatMap(({ repo, date }) => {
      debug(`Analyzing ${repo.full_name} at ${date}`);
      return repoAnalysisPipeline(repo, date);
    }),

    mergeMap(({ repo, date, stats }) => {
      const { langs } = stats;
      return rxjs.from(keys(langs)).pipe(
        map((langKey) => {
          const { files, lines } = langs[langKey];
          return `${repo.full_name},${date},${langKey},${files},${lines}`;
        })
      );
    })
  ).subscribe(dump);
};
