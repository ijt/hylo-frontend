var d3 = window.d3,
  nv = window.nv;

module.exports = {

  render: function(opts) {

    nv.addGraph(function() {
      var chart;

      switch (opts.type) {
        case 'line':
          chart = nv.models.lineChart()
            .x(d => d[0])
            .y(d => d[1]);
          break;
        case 'bar':
          chart = nv.models.multiBarChart()
            .x(d => d[0])
            .y(d => d[1])
            .clipEdge(true)
            .stacked(true)
            .showControls(false);
      }

      chart.xAxis
        .showMaxMin(false)
        .tickFormat(d => d3.time.format('%x')(new Date(d)));

      chart.yAxis
        .tickFormat(d3.format(',.2f'));

      if (opts.setup) opts.setup(chart);

      d3.select(opts.to)
        .datum(opts.data)
        .transition().duration(500).call(chart);

      nv.utils.windowResize(chart.update);

      return chart;
    });

  }
};
