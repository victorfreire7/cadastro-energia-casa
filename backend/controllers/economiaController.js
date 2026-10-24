const { calcularEconomia } = require('../services/economia');

// POST /dimensionamento/economia
// Corpo: { tarifaReaisKwh, tarifaFonte, energiaGeradaKwhMes, consumoKwhMes, energiaCompensadaKwhMes? }
async function estimar(req, res) {
  const resultado = calcularEconomia(req.body || {});
  if (resultado.erros) {
    return res.status(400).json({
      message: 'não foi possível estimar a economia: ' + resultado.erros[0],
      erros: resultado.erros
    });
  }
  res.json(resultado);
}

module.exports = { estimar };
