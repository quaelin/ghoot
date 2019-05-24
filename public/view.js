/* global _, $, d3, localStorage, window */

const storedPrefs = localStorage.getItem('ghoot');
const prefs = storedPrefs ? JSON.parse(storedPrefs) : {
  groupBy: 'language', // either 'language' or 'repo'
  colors: ['#a6cee3', '#1f78b4', '#b2df8a', '#33a02c', '#fb9a99', '#e31a1c', '#fdbf6f', '#ff7f00', '#cab2d6', '#6a3d9a', '#888888'],
  language: {
    'Comma Separated Values': false,
    'Tab Separated Values': false,
    Text: false,
  },
  repo: {
  },
};
const savePrefs = () => {
  localStorage.setItem('ghoot', JSON.stringify(prefs));
};

const importedCSVData = new Promise((resolve) => { // eslint-disable-line promise/avoid-new
  d3.csv(
    // Input records are in this format:
    // { repo, date, language, files, lines }
    'data.csv',

    // Format each record's date and numbers
    r => ({
      ...r,
      dateObj: d3.timeParse('%Y-%m-%d')(r.date),
      files: Number(r.files),
      lines: Number(r.lines),
    }),

    resolve
  );
});

const filterByPrefs = data => (_.filter(data, r => (
  prefs.language[r.language] !== false
    && prefs.repo[r.repo] !== false
)));

// Find the top 10 languages by total line count, and group everything else as 'Other'.
const getTopLangs = data => ([
  ..._.map(_.slice(_.reverse(_.sortBy(
    _.flatMap(
      _.groupBy(data, 'language'),
      (recsByLang, lang) => ({ lang, totalLines: _.sumBy(recsByLang, 'lines') })
    ),
    'totalLines'
  )), 0, 10), 'lang'),
  'Other',
]);

// Find the top 10 repos by total line count, and group everything else as 'Other'
const getTopRepos = data => ([
  ..._.map(_.slice(_.reverse(_.sortBy(
    _.flatMap(
      _.groupBy(data, 'repo'),
      (recsByRepo, repo) => ({ repo, totalLines: _.sumBy(recsByRepo, 'lines') })
    ),
    'totalLines'
  )), 0, 10), 'repo'),
  'Other',
]);

const getTopGroups = data => (prefs.groupBy === 'language' ? getTopLangs(data) : getTopRepos(data));

const stackDataByGroup = (data, groups) => {
  const recordsByDate = _.groupBy(data, 'date');
  const recordsByDateAndGroup = _.flatMap(recordsByDate, (recsByDate, date) => ({
    date,
    dateObj: recsByDate[0].dateObj,
    ..._.zipObject(groups, _.range(0, groups.length, 0)),
    ..._.mapValues(
      _.groupBy(recsByDate, rec => (
        _.includes(groups, rec[prefs.groupBy]) ? rec[prefs.groupBy] : 'Other'
      )),
      recsByLang => _.sumBy(recsByLang, 'lines')
    ),
  }));
  return {
    stackedData: d3.stack().keys(groups)(recordsByDateAndGroup),
    maxTotalLines: _.max(_.values(_.mapValues(recordsByDate, recs => (_.sumBy(recs, 'lines'))))),
  };
};

const getDimensions = () => {
  const margin = {
    top: 75,
    right: 220,
    bottom: 50,
    left: 100,
  };
  const width = 1000 - margin.left - margin.right;
  const height = 500 - margin.top - margin.bottom;
  return { height, margin, width };
};

const emptyChartSvg = ({ height, margin, width }) => {
  $('#dataviz').empty();
  return d3.select('#dataviz')
    .append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);
};

const createXAxis = ({ data, dimensions, svg }) => {
  const xScaler = d3.scaleTime()
    .domain(d3.extent(data, d => d.dateObj))
    .range([0, dimensions.width]);
  const xAxis = svg.append('g')
    .attr('transform', `translate(0,${dimensions.height})`)
    .call(d3.axisBottom(xScaler));
  const xLabel = svg.append('text')
    .attr('text-anchor', 'end')
    .attr('x', dimensions.width)
    .attr('y', dimensions.height + 40)
    .text('Date');
  return { xAxis, xScaler, xLabel };
};

const createYAxis = ({ height, maxTotalLines, svg }) => {
  const yScaler = d3.scaleLinear()
    .domain([0, maxTotalLines])
    .range([height, 0]);
  const yAxis = svg.append('g')
    .call(d3.axisLeft(yScaler));
  const yLabel = svg.append('text')
    .attr('text-anchor', 'end')
    .attr('x', 0)
    .attr('y', -20)
    .text('Lines of code')
    .attr('text-anchor', 'start');
  return { yAxis, yScaler, yLabel };
};

// Add a clipPath: everything out of this area won't be drawn.
const addClipPath = ({ height, svg, width }) => {
  svg.append('defs').append('svg:clipPath')
    .attr('id', 'clip')
    .append('svg:rect')
    .attr('width', width)
    .attr('height', height)
    .attr('x', 0)
    .attr('y', 0);
};

const cssSafe = str => str.replace(/[ /]/g, '-');

const highlight = (d) => {
  d3.selectAll('.langArea').style('opacity', 0.1);
  d3.select(`.langArea-${cssSafe(d)}`).style('opacity', 1);
};

const noHighLight = () => d3.selectAll('.langArea').style('opacity', 1);

const createLegend = ({ color, groups, svg }) => {
  const dotSize = 15;
  const legendX = 690;
  svg.selectAll('myrect')
    .data(groups)
    .enter()
    .append('rect')
    .attr('x', legendX)
    .attr('y', (d, i) => 10 + (i * (dotSize + 5)))
    .attr('width', dotSize)
    .attr('height', dotSize)
    .style('fill', (d, i) => color(i));
  // .on('mouseover', highlight)
  // .on('mouseout', noHighLight);
  svg.selectAll('mylabels')
    .data(groups)
    .enter()
    .append('text')
    .attr('x', legendX + (dotSize * 1.2))
    .attr('y', (d, i) => 10 + (i * (dotSize + 5)) + (dotSize / 2))
    .style('fill', (d, i) => color(i))
    .text(d => d)
    .attr('text-anchor', 'left')
    .style('alignment-baseline', 'middle');
  // .on('mouseover', highlight)
  // .on('mouseout', noHighLight);
};

const render = (allData) => { // eslint-disable-line max-statements
  // Filter, group and stack the data
  const data = filterByPrefs(allData);
  const groups = getTopGroups(data);
  const groupIndices = _.map(groups, (group, idx) => idx);
  const { stackedData, maxTotalLines } = stackDataByGroup(data, groups);

  const dimensions = getDimensions();
  const { height, width } = dimensions;
  const svg = emptyChartSvg(dimensions);
  const color = d3.scaleOrdinal()
    .domain(groupIndices)
    .range(prefs.colors);
  const { xAxis, xScaler } = createXAxis({ data, dimensions, svg });
  const { yScaler } = createYAxis({ height, maxTotalLines, svg });
  addClipPath({ height, svg, width });

  // Create the scatter variable: where both the circles and the brush take place
  const areaChart = svg.append('g').attr('clip-path', 'url(#clip)');

  // Area generator
  const area = d3.area()
    .x(d => xScaler(d.data.dateObj))
    .y0(d => yScaler(d[0]))
    .y1(d => yScaler(d[1]));

  let brush;
  let idleTimeout;
  const idled = () => { idleTimeout = null; };

  const updateChart = () => {
    const extent = d3.event.selection;

    // If no selection, back to initial coordinate. Otherwise, update X axis domain
    if (!extent) {
      if (!idleTimeout) {
        idleTimeout = setTimeout(idled, 350); // This allows to wait a little bit
        return;
      }
      xScaler.domain(d3.extent(data, d => d.date));
    } else {
      xScaler.domain([xScaler.invert(extent[0]), xScaler.invert(extent[1])]);
      areaChart.select('.brush').call(brush.move, null); // This remove the grey brush area as soon as the selection has been done
    }

    // Update axis and area position
    xAxis.transition().duration(1000).call(d3.axisBottom(xScaler).ticks(5));
    areaChart.selectAll('path')
      .transition().duration(1000)
      .attr('d', area);
  };

  // Add brushing
  brush = d3.brushX() // Add the brush feature using the d3.brush function
    .extent([[0, 0], [width, height]]) // brush area: it means I select the whole graph area
    .on('end', updateChart); // Each time the brush selection changes, trigger the 'updateChart' function

  areaChart.selectAll('mylayers')
    .data(stackedData)
    .enter()
    .append('path')
    .attr('class', d => `langArea langArea-${cssSafe(d.key)}`)
    .style('fill', d => color(d.index))
    .attr('d', area);

  // Add the brushing
  areaChart.append('g')
    .attr('class', 'brush')
    .call(brush);

  // Legend
  createLegend({ color, groups, svg });
};

const populateFilterList = (allData) => {
  // Store a boolean pref for each langauge and each repo
  _.each(allData, ({ language, repo }) => {
    if (!_.has(prefs.language, language)) {
      prefs.language[language] = true;
    }
    if (!_.has(prefs.repo, repo)) {
      prefs.repo[repo] = true;
    }
  });

  // Create checkboxes to show the state of each pref
  const filterList = $('.filterList');
  const sortedLanguages = _.keys(prefs.language).sort();
  _.each(sortedLanguages, (language) => {
    const item = filterList.append('<div class="item"></div>');
    item.append(`<input type="checkbox" name="lang:${cssSafe(language)}" value="${language}" ${prefs.language[language] ? 'checked="checked" ' : ''}/>`);
    item.append(`<label for="lang:${cssSafe(language)}">${language}</label>`);
  });
  filterList.append('<hr />');
  const sortedRepos = _.keys(prefs.repo).sort();
  _.each(sortedRepos, (repo) => {
    const item = filterList.append('<div class="item"></div>');
    item.append(`<input type="checkbox" name="repo:${cssSafe(repo)}" value="${repo}" ${prefs.repo[repo] ? 'checked="checked" ' : ''}/>`);
    item.append(`<label for="repo:${cssSafe(repo)}">${repo}</label>`);
  });

  // When the checkboxes are modified, update the prefs
  filterList.click(async () => {
    const checkboxes = $('.filterList input[type=checkbox]');
    checkboxes.each(function () { // eslint-disable-line func-names
      const checkbox = $(this);
      const name = checkbox.attr('name');
      const value = checkbox.attr('value');
      const isChecked = !!checkbox.prop('checked');
      if (_.startsWith(name, 'lang:')) {
        prefs.language[value] = isChecked;
      } else {
        prefs.repo[value] = isChecked;
      }
    });
    render(await importedCSVData);
  });
  return allData;
};

// eslint-disable-next-line promise/catch-or-return
importedCSVData.then(populateFilterList).then(render);

const checkSettings = async () => {
  prefs.groupBy = $('input[name=groupBy]:checked').val();
  render(await importedCSVData);
};

$('#groupByLanguage').click(checkSettings);
$('#groupByRepo').click(checkSettings);

$(window).on('beforeunload', savePrefs);
