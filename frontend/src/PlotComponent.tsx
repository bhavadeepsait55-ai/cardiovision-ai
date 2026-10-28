import Plotly from "plotly.js/lib/core";
import Scatter from "plotly.js/lib/scatter";
import ScatterGl from "plotly.js/lib/scattergl";
import createPlotlyComponent from "react-plotly.js/factory";

Plotly.register([Scatter, ScatterGl]);

export default createPlotlyComponent(Plotly);
