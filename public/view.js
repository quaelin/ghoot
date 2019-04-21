/* global _, d3 */
const margin = {
  top: 75,
  right: 230,
  bottom: 50,
  left: 75,
};
const width = 1000 - margin.left - margin.right;
const height = 500 - margin.top - margin.bottom;

const svg = d3.select('#dataviz')
  .append('svg')
  .attr('width', width + margin.left + margin.right)
  .attr('height', height + margin.top + margin.bottom)
  .append('g')
  .attr('transform', `translate(${margin.left},${margin.top})`);

// Find the top 10 languages by total line count, and group everything else as 'Other'
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

const reshapeData = (data, langs) => {
  const recordsByDate = _.groupBy(data, 'date');
  const groupedByDateAndLanguage = _.flatMap(recordsByDate, (recsByDate, date) => ({
    date,
    dateObj: recsByDate[0].dateObj,
    ..._.zipObject(langs, _.range(0, langs.length, 0)),
    ..._.mapValues(
      _.groupBy(recsByDate, rec => (_.includes(langs, rec.language) ? rec.language : 'Other')),
      recsByLang => _.sumBy(recsByLang, 'lines')
    ),
  }));
  return {
    stackedData: d3.stack().keys(langs)(groupedByDateAndLanguage),
    maxTotalLines: _.max(_.values(_.mapValues(recordsByDate, recs => (_.sumBy(recs, 'lines'))))),
  };
};

d3.csv(
  // Input records are in this format:
  // { repo, date, language, files, lines }
  'data.csv',

  // Format each record
  r => ({
    ...r,
    dateObj: d3.timeParse('%Y-%m-%d')(r.date),
    files: Number(r.files),
    lines: Number(r.lines),
  }),

  (data) => { // eslint-disable-line max-statements
    // Find the top-10 languages by total line count
    const langs = getTopLangs(data);
    const langIndices = _.map(langs, (lang, idx) => idx);

    // Reshape the data for a stacked area chart, highlighing just the top languages
    const { stackedData, maxTotalLines } = reshapeData(data, langs);
    console.log(stackedData);

    const color = d3.scaleOrdinal()
      .domain(langIndices)
      .range(d3.schemePaired);

    // Add X axis
    const xScaler = d3.scaleTime()
      .domain(d3.extent(data, d => d.dateObj))
      .range([0, width]);
    const xAxis = svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(xScaler));
    svg.append('text')
      .attr('text-anchor', 'end')
      .attr('x', width)
      .attr('y', height + 40)
      .text('Date');

    // Add Y axis
    const yScaler = d3.scaleLinear()
      .domain([0, maxTotalLines])
      .range([height, 0]);
    const yAxis = svg.append('g')
      .call(d3.axisLeft(yScaler));
    svg.append('text')
      .attr('text-anchor', 'end')
      .attr('x', 0)
      .attr('y', -20)
      .text('Lines of code')
      .attr('text-anchor', 'start');

    // Add a clipPath: everything out of this area won't be drawn.
    const clip = svg.append('defs').append('svg:clipPath')
      .attr('id', 'clip')
      .append('svg:rect')
      .attr('width', width)
      .attr('height', height)
      .attr('x', 0)
      .attr('y', 0);

    // Add brushing
    let updateChart; // defined below
    const brush = d3.brushX() // Add the brush feature using the d3.brush function
      .extent([[0, 0], [width, height]]) // brush area: it means I select the whole graph area
      .on('end', updateChart); // Each time the brush selection changes, trigger the 'updateChart' function

    // Create the scatter variable: where both the circles and the brush take place
    const areaChart = svg.append('g')
      .attr('clip-path', 'url(#clip)');

    // Area generator
    const area = d3.area()
      .x(d => xScaler(d.data.dateObj))
      .y0(d => yScaler(d[0]))
      .y1(d => yScaler(d[1]));

    areaChart.selectAll('mylayers')
      .data(stackedData)
      .enter()
      .append('path')
      .attr('class', d => `langArea langArea-${d.key}`)
      .style('fill', d => color(d.index))
      .attr('d', area);

    // Add the brushing
    areaChart.append('g')
      .attr('class', 'brush')
      .call(brush);

    let idleTimeout;
    const idled = () => { idleTimeout = null; };

    updateChart = () => {
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

    const highlight = (d) => {
      d3.selectAll('.langArea').style('opacity', 0.1);
      d3.select(`.langArea-${d}`).style('opacity', 1);
    };
    const noHighLight = () => d3.selectAll('.langArea').style('opacity', 1);

    // Legend
    const dotSize = 20;
    const legendX = 730;
    svg.selectAll('myrect')
      .data(langs)
      .enter()
      .append('rect')
      .attr('x', legendX)
      .attr('y', (d, i) => 10 + (i * (dotSize + 5)))
      .attr('width', dotSize)
      .attr('height', dotSize)
      .style('fill', (d, i) => color(i))
      .on('mouseover', highlight)
      .on('mouseout', noHighLight);
    svg.selectAll('mylabels')
      .data(langs)
      .enter()
      .append('text')
      .attr('x', legendX + (dotSize * 1.2))
      .attr('y', (d, i) => 10 + (i * (dotSize + 5)) + (dotSize / 2))
      .style('fill', (d, i) => color(i))
      .text(d => d)
      .attr('text-anchor', 'left')
      .style('alignment-baseline', 'middle')
      .on('mouseover', highlight)
      .on('mouseout', noHighLight);
  }
);
