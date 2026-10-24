const { calcularPayback } = require('../services/payback');

// POST /dimensionamento/payback
// Corpo: { investimentoTotal, economiaAnual }
async function calcular(req, res) {
  const resultado = calcularPayback(req.body || {});
  if (resultado.erros) {
    return res.status(400).json({
      message: 'não foi possível calcular o payback simples: ' + resultado.erros[0],
      erros: resultado.erros
    });
  }
  res.json(resultado);
}

module.exports = { calcular };
