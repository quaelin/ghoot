const {
  endsWith,
  find,
  keys,
  range,
} = require('lodash');
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

const pad2 = num => (num < 10 ? `0${num}` : `${num}`);

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
  const gitReset = async repo => exec('git reset --hard HEAD', { cwd: repoDir(repo) });

  const checkoutDate = async (repo, date) => {
    debug(`Looking for ${repo.name} as of ${date}`);
    const commit = await getCommitAtDate(repo, date);
    await gitReset(repo);
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

  const detectLanguage = async (filePath) => {
    // These are *not* handled by language-detect
    const extraFileExtensions = {
      '.conf': 'Shell',
      '.csv': 'Comma Separated Values',
      '.emblem': 'Emblem',
      '.fdoc': 'FDOC',
      '.ipynb': 'Jupyter Notebook',
      '.jmx': 'JMeter Maven Plugin',
      '.js.snap': 'Jest',
      '.jsx.snap': 'Jest',
      '.make': 'Makefile',
      '.mdown': 'Markdown',
      '.pl': 'Perl', // language-detect considers .pl to be Prolog, but it rarely is
      '.react.js': 'React',
      '.react.jsx': 'React',
      '.react.ts': 'React',
      '.react.tsx': 'React',
      '.ts': 'Typescript',
      '.ts.snap': 'Jest',
      '.tsx': 'Typescript',
      '.tsx.snap': 'Jest',
      '.tsv': 'Tab Separated Values',
    };
    const lang = find(extraFileExtensions, (name, ext) => endsWith(filePath, ext));
    return lang || detect(filePath);
  };

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
        language: isBinary ? null : await detectLanguage(file.fullPath).catch(() => null),
      };
    }),

    // Filter out any files where we failed to detect a language
    filter(({ language }) => !!language),

    // Roll up the stats
    reduce((stats, { lines, language }) => {
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
    // Filter out repos that are not X (for testing)
    // filter(repo => repo.full_name === 'X/X'),

    // Clone repo, or checkout the default branch if it already exists
    concatMap(async (repo) => {
      try {
        await cloneRepo(repo);
      } catch (ex) {
        await gitReset(repo);
        await gitClean(repo);
        const { default_branch: defaultBranch } = repo;
        await exec(`git checkout ${defaultBranch}`, { cwd: repoDir(repo) });
      }
      return repo;
    }),

    // Count down months from current year to 2008 (first full year of Github history)
    mergeMap(repo => rxjs.from(range(new Date().getFullYear(), 2007, -1)).pipe(
      mergeMap(year => rxjs.from(range(12, 0, -1)).pipe(
        map(month => ({ repo, date: `${year}-${pad2(month)}-01` }))
      ))
    )),

    // Filter out future dates
    filter(({ date }) => new Date(date) < new Date()),

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
